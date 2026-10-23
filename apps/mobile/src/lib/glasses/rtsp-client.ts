// Minimal RTSP client + RTP/JPEG receiver for the glasses' video. Does the
// real wire negotiation PROTOCOL_GLASSES.md describes ("Standard RTSP:
// OPTIONS, DESCRIBE, SETUP, PLAY... Transport: UDP... keepalive (OPTIONS)
// every ≤ 30 s") and reassembles RFC 2435 JPEG-over-RTP frames via
// rtp-jpeg.ts into real, displayable JPEG files.
//
// This has not been validated against real hardware yet -- the RTP/JPEG
// reconstruction logic was checked structurally (marker/length
// self-consistency) but not against an actual decoded image, and RTSP
// server behavior varies enough between implementations that the exact
// request sequence below may need adjusting once tested for real.
import TcpSocket from "react-native-tcp-socket";
import dgram from "react-native-udp";
// Explicit import, not the bare global -- see rtp-jpeg.ts's comment.
import { Buffer } from "buffer";

import { buildJpegFile, parseJpegRtpPayload, parseRtpHeader } from "./rtp-jpeg";

type TcpSocketInstance = InstanceType<typeof TcpSocket.Socket>;
type UdpSocketInstance = ReturnType<typeof dgram.createSocket>;

const RTSP_PORT = 554;
const OPTIONS_KEEPALIVE_MS = 25000;

interface RtspResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function parseRtspUrl(url: string): { host: string; port: number } {
  const match = /^rtsp:\/\/([^:/]+)(?::(\d+))?/i.exec(url);
  if (!match) throw new Error(`Not an rtsp:// URL: ${url}`);
  return { host: match[1], port: match[2] ? Number(match[2]) : RTSP_PORT };
}

function parseRtspResponse(text: string): RtspResponse {
  const [headPart, ...bodyParts] = text.split("\r\n\r\n");
  const lines = headPart.split("\r\n");
  const statusMatch = /^RTSP\/1\.0 (\d+)/.exec(lines[0] ?? "");
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { statusCode, headers, body: bodyParts.join("\r\n\r\n") };
}

export interface RtpJpegFrame {
  jpeg: Buffer;
  rtpTimestamp: number;
  receivedAt: number;
}

export class RtspJpegClient {
  private url: string;
  private onFrame: (frame: RtpJpegFrame) => void;
  private onLog: (line: string) => void;

  private tcp: TcpSocketInstance | null = null;
  private udp: UdpSocketInstance | null = null;
  private cseq = 0;
  private session: string | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  // Reassembly state for the frame currently in progress. Fragments are
  // keyed by their RFC 2435 `fragmentOffset`, not pushed in arrival order --
  // UDP can reorder or drop packets, and silently concatenating whatever
  // arrived in whatever order produced exactly the "broken/static" frames
  // this was built to avoid: a dropped or reordered packet still assembled
  // into *something*, just a corrupted JPEG the decoder then rendered as
  // garbage instead of this code noticing and dropping the frame. Verified
  // against the HW team's own reference (rtp_jpeg.py's `JpegDepacketizer`),
  // which does the same offset-indexed collect-then-verify-contiguous
  // approach before ever building a JPEG.
  private currentTimestamp: number | null = null;
  private currentFragments: Map<number, Buffer> = new Map();
  private currentInfo: { type: number; width: number; height: number; quantTables: Buffer[] | null } | null = null;

  private pendingResponses: ((text: string) => void)[] = [];
  private tcpBuffer = "";

  // A fixed, caller-chosen local port -- NOT 0 ("let the OS pick"). This
  // library's Android bind() has a real bug: when asked for a random port
  // (0), its native side reports the bind as succeeding on port 0 itself
  // (it echoes back the port you asked for, not the one the OS actually
  // assigned -- see react-native-udp's UdpSockets.java `bind()`, which does
  // `result.putInt("port", port)` with the original argument, never
  // `socket.getLocalPort()`). `address().port` then also reads 0, which we
  // were sending as our RTSP `client_port` -- the board dutifully tried to
  // send RTP to UDP port 0, which can't receive anything, so nothing ever
  // arrived. Binding to an explicit, known port sidesteps the bug entirely:
  // the echoed value is correct whenever it isn't 0 to begin with.
  // localAddress, not left as the default "0.0.0.0": react-native-tcp-
  // socket's own native connect() binds to "0.0.0.0" unless told otherwise,
  // which leaves Android free to pick whatever it considers the default
  // route for an outbound connection -- and that's frequently NOT the
  // phone's LocalOnlyHotspot interface, since a hotspot's clients are a
  // private subnet with no default-route reason to prefer it over e.g.
  // cellular data. That mismatch is exactly what an error like "failed to
  // connect ... from /:: ... ECONNABORTED (Software caused connection
  // abort)" looks like -- the OS aborting a connect attempt that went out
  // the wrong interface for a destination only reachable via the other
  // one. Binding explicitly to the phone's own gateway IP on the hotspot
  // (same value shown as "gateway" when the hotspot starts) forces the
  // kernel to route this connection out that specific interface, since a
  // socket can only bind to a local IP actually configured on one.
  constructor(
    url: string,
    private readonly localPort: number,
    private readonly localAddress: string | undefined,
    onFrame: (frame: RtpJpegFrame) => void,
    onLog: (line: string) => void = () => {}
  ) {
    this.url = url;
    this.onFrame = onFrame;
    this.onLog = onLog;
  }

  // Same race as glasses-link.ts's identically-named helper: these native
  // socket methods are fire-and-forget (no Promise), so calling one on a
  // socket the native side already tore down throws an uncatchable
  // "IllegalArgumentException: No socket with id N" that crashes the whole
  // app instead of just this client. Routing destroy()/write() through this
  // wrapper turns that into a harmless log line.
  private safeSocketOp(label: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.onLog(`RTSP: ${label} ignored (socket already gone) -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async start(): Promise<void> {
    const { host, port } = parseRtspUrl(this.url);

    this.udp = dgram.createSocket({ type: "udp4" });
    await new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
      this.udp!.once("error", onError);
      this.udp!.bind(this.localPort, undefined, () => {
        this.udp!.removeListener("error", onError);
        resolve();
      });
    });
    const localPort = this.localPort;
    this.udp.on("message", (msg: Buffer) => this.handleRtpPacket(msg));
    this.onLog(`RTSP: UDP receiver on local port ${localPort}`);

    this.tcp = TcpSocket.createConnection({ host, port, localAddress: this.localAddress }, () => {
      this.onLog(`RTSP: connected to ${host}:${port}`);
    });
    this.tcp.setEncoding("utf8");
    this.tcp.on("data", (data) => this.handleTcpData(typeof data === "string" ? data : data.toString("utf8")));
    this.tcp.on("error", (err) => this.onLog(`RTSP: TCP error: ${err.message}`));

    await this.waitForConnect();
    await this.request("OPTIONS", this.url);
    await this.request("DESCRIBE", this.url, { Accept: "application/sdp" });

    const setupResponse = await this.request("SETUP", this.url, {
      Transport: `RTP/AVP;unicast;client_port=${localPort}-${localPort + 1}`,
    });
    const sessionHeader = setupResponse.headers.session;
    this.session = sessionHeader ? sessionHeader.split(";")[0].trim() : null;
    if (!this.session) throw new Error("RTSP SETUP didn't return a Session header");
    this.onLog(`RTSP: session ${this.session}, transport: ${setupResponse.headers.transport ?? "?"}`);

    await this.request("PLAY", this.url, { Session: this.session });
    this.onLog("RTSP: playing");

    this.keepaliveTimer = setInterval(() => {
      this.request("OPTIONS", this.url, this.session ? { Session: this.session } : {}).catch((err) =>
        this.onLog(`RTSP: keepalive failed: ${err instanceof Error ? err.message : String(err)}`)
      );
    }, OPTIONS_KEEPALIVE_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    if (this.tcp && this.session) {
      try {
        await this.request("TEARDOWN", this.url, { Session: this.session });
      } catch {
        // best effort -- we're closing the sockets regardless
      }
    }
    if (this.tcp) this.safeSocketOp("tcp destroy", () => this.tcp!.destroy());
    this.tcp = null;
    if (this.udp) this.safeSocketOp("udp close", () => this.udp!.close());
    this.udp = null;
  }

  private waitForConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.tcp) {
        reject(new Error("no TCP socket"));
        return;
      }
      const onConnect = () => {
        this.tcp?.removeListener("error", onError);
        resolve();
      };
      const onError = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
      this.tcp.once("connect", onConnect);
      this.tcp.once("error", onError);
    });
  }

  private handleTcpData(chunk: string) {
    this.tcpBuffer += chunk;
    // RTSP responses are separated by a blank line after the headers, with
    // an optional length-prefixed body (SDP, for DESCRIBE) immediately
    // following with no further delimiter -- simplified here by relying on
    // Content-Length when present, which every response we send a request
    // for either has or doesn't need.
    for (;;) {
      const headerEnd = this.tcpBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerText = this.tcpBuffer.slice(0, headerEnd);
      const contentLengthMatch = /content-length:\s*(\d+)/i.exec(headerText);
      const contentLength = contentLengthMatch ? Number(contentLengthMatch[1]) : 0;
      const totalLength = headerEnd + 4 + contentLength;
      if (this.tcpBuffer.length < totalLength) return;

      const full = this.tcpBuffer.slice(0, totalLength);
      this.tcpBuffer = this.tcpBuffer.slice(totalLength);
      const resolve = this.pendingResponses.shift();
      resolve?.(full);
    }
  }

  private request(method: string, url: string, headers: Record<string, string> = {}): Promise<RtspResponse> {
    return new Promise((resolve, reject) => {
      if (!this.tcp) {
        reject(new Error("RTSP: not connected"));
        return;
      }
      this.cseq += 1;
      const seq = this.cseq;
      const lines = [`${method} ${url} RTSP/1.0`, `CSeq: ${seq}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", ""];
      const timer = setTimeout(() => reject(new Error(`RTSP ${method}: timed out`)), 5000);

      this.pendingResponses.push((text) => {
        clearTimeout(timer);
        const response = parseRtspResponse(text);
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response);
        else reject(new Error(`RTSP ${method} failed: ${response.statusCode}`));
      });
      this.safeSocketOp("write", () => this.tcp!.write(lines.join("\r\n")));
    });
  }

  private handleRtpPacket(packet: Buffer) {
    const header = parseRtpHeader(packet);
    if (!header || header.payloadType !== 26) return; // 26 = JPEG, per the spec
    // .slice(), not .subarray() -- see rtp-jpeg.ts's comment on the same
    // issue: Hermes's TypedArray subarray() doesn't preserve the Buffer
    // subclass, silently handing back a plain Uint8Array missing every
    // Node-Buffer-specific method (readUInt16BE, copy, ...) that
    // parseJpegRtpPayload and buildJpegFile both rely on downstream.
    const payload = parseJpegRtpPayload(packet.slice(header.payloadOffset));
    if (!payload) return;

    if (this.currentTimestamp !== header.timestamp) {
      if (this.currentFragments.size > 0) {
        this.onLog(`RTSP: incomplete frame (ts=${this.currentTimestamp}) -- dropped, never got the marker packet`);
      }
      this.currentTimestamp = header.timestamp;
      this.currentFragments = new Map();
      this.currentInfo = null;
    }

    // Per RFC 2435, type/q/width/height/quant-tables are only meaningful on
    // the first fragment (fragmentOffset === 0) -- a reordered later
    // fragment arriving first must not be mistaken for it.
    if (payload.fragmentOffset === 0) {
      this.currentInfo = {
        type: payload.type,
        width: payload.width,
        height: payload.height,
        quantTables: payload.quantTables?.map((t) => t.tableData) ?? null,
      };
    }
    this.currentFragments.set(payload.fragmentOffset, payload.scanData);

    if (header.marker) {
      const tsForFrame = header.timestamp;
      const frame = this.reassembleFrame(tsForFrame);
      this.currentTimestamp = null;
      this.currentFragments = new Map();
      this.currentInfo = null;
      if (frame) this.onFrame(frame);
    }
  }

  // Sorts fragments by offset and requires them to be contiguous (no gaps)
  // before building a JPEG -- a missing or duplicated fragment here used to
  // still produce *a* JPEG, just a corrupted one the decoder rendered as
  // "static"/garbled blocks instead of this noticing and dropping the frame.
  private reassembleFrame(rtpTimestamp: number): RtpJpegFrame | null {
    if (!this.currentInfo?.quantTables) {
      this.onLog("RTSP: frame had no fragment-0 info/quant-tables -- dropped");
      return null;
    }
    const offsets = [...this.currentFragments.keys()].sort((a, b) => a - b);
    const parts: Buffer[] = [];
    let expected = 0;
    for (const offset of offsets) {
      if (offset !== expected) {
        this.onLog(`RTSP: gap in JPEG fragments (expected byte ${expected}, got ${offset}) -- frame dropped`);
        return null;
      }
      const chunk = this.currentFragments.get(offset)!;
      parts.push(chunk);
      expected += chunk.length;
    }
    const jpeg = buildJpegFile(Buffer.concat(parts), this.currentInfo.width, this.currentInfo.height, this.currentInfo.quantTables, this.currentInfo.type);
    return { jpeg, rtpTimestamp, receivedAt: Date.now() };
  }
}
