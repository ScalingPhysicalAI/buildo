// GloveLink: BLE setup and the Wi-Fi handoff to the haptic glove, per
// PROTOCOL_GLOVE.md. The command channel (TCP 5010) is a port shared with
// glasses -- see shared-command-port.ts's own comment for why that has to
// be a single shared listener rather than a second server on the same
// port. The data channel (TCP 5008, fixed-size binary packets) is this
// link's own, unshared server -- no port conflict with glasses' data
// channel (5005).
import TcpSocket from "react-native-tcp-socket";
import { Buffer } from "buffer";

import { withScanLock } from "../ble/scan-lock";
import { NordicUartLink, type Device } from "../ble/nordic-uart-link";
import { acquireHotspot, releaseHotspot } from "../shared-hotspot";
import { sharedCommandPort, type CommandDeviceKind } from "../shared-command-port";
import { type LocalHotspotReservation } from "../glasses/hotspot";
import {
  buildCommandLine,
  GLOVE_WIRE_FRAME_SIZE,
  isGloveWifiEvent,
  parseCommandLine,
  readUInt64LE,
  type AckMessage,
  type CommandChannelMessage,
  type GloveCommand,
  type HelloMessage,
  type StatusMessage,
} from "./protocol";

// Bytes 16-317 are AES-CTR ciphertext + a 16-byte HMAC tag (DATA_ENCRYPTION.md)
// -- this app has no key, so a "packet" is just the readable 16-byte header
// plus the raw, undecoded frame, mirroring glasses' RawRtpPacket.
export interface RawGlovePacket {
  bootId: number;
  seq: number;
  assembledAtMs: number;
  frame: Buffer;
}

export const GLOVE_BLE_DEVICE_NAME = "Glove";
export const GLOVE_DATA_PORT = 5008;
const THIS_DEVICE: CommandDeviceKind = "glove";

type TcpSocketInstance = InstanceType<typeof TcpSocket.Socket>;
type Listener<T> = (payload: T) => void;

class TinyEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<Events[keyof Events]>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = (this.listeners.get(event) as Set<Listener<Events[K]>> | undefined) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set as Set<Listener<Events[keyof Events]>>);
    return () => set.delete(listener);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    (this.listeners.get(event) as Set<Listener<Events[K]>> | undefined)?.forEach((listener) => listener(payload));
  }
}

interface GloveLinkEvents {
  log: { line: string };
  bleWifiEvent: { event: "down" | "status" | "up"; ssid: string | null };
  hello: HelloMessage;
  status: StatusMessage;
  commandMessage: CommandChannelMessage;
  rawPacket: RawGlovePacket;
  connectionStateChange: { connected: boolean };
  bleDisconnected: Record<string, never>;
}

const STATUS_TIMEOUT_MS = 6000; // same heartbeat window glasses uses -- no protocol-specified value for this

export class GloveLink extends TinyEmitter<GloveLinkEvents> {
  private ble = new NordicUartLink();
  private bleUnsub: (() => void) | null = null;
  private bleDisconnectUnsub: (() => void) | null = null;

  private unregisterCommandPort: (() => void) | null = null;
  private dataServer: InstanceType<typeof TcpSocket.Server> | null = null;
  private commandSocket: TcpSocketInstance | null = null;
  private dataSocket: TcpSocketInstance | null = null;
  private commandBuffer = "";
  private dataBuffer: Buffer = Buffer.alloc(0);

  private commandSeq = 0;
  private pendingAcks = new Map<number, { timer: ReturnType<typeof setTimeout>; resolve: (ack: AckMessage | null) => void }>();

  private lastStatusAt = 0;
  private statusWatchdog: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  private highestDataSeq = -1;
  private dataBootId: number | null = null;
  private dataAckTimer: ReturnType<typeof setInterval> | null = null;
  private dataAckWarned = false;

  private hotspotAcquired = false;

  private log(line: string) {
    this.emit("log", { line });
  }

  // Same "native socket already torn down" hazard glasses-link.ts guards
  // against -- see that file's safeSocketOp comment for the exact failure.
  private safeSocketOp(label: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.log(`TCP ${label}: ignored (socket already gone) -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -- Phone-hosted hotspot (shared with glasses) ---------------------------

  async startHotspot(): Promise<LocalHotspotReservation> {
    this.log("Hotspot: acquiring…");
    const reservation = await acquireHotspot();
    this.hotspotAcquired = true;
    this.log(`Hotspot: ready, ssid="${reservation.ssid}" gateway=${reservation.gatewayIp}`);
    return reservation;
  }

  async stopHotspot(): Promise<void> {
    if (!this.hotspotAcquired) return;
    await releaseHotspot();
    this.hotspotAcquired = false;
    this.log("Hotspot: released");
  }

  // -- BLE setup (Nordic UART, "Glove") -------------------------------------

  async connectBle(timeoutMs = 10000): Promise<void> {
    this.log(`BLE: scanning for "${GLOVE_BLE_DEVICE_NAME}"…`);
    await withScanLock(() => this.ble.connectByName(GLOVE_BLE_DEVICE_NAME, timeoutMs));
    this.log("BLE: connected");
    this.wireBleWifiEvents();
  }

  async startBleScan(onDevice: (device: Device) => void): Promise<void> {
    this.log("BLE: scanning for all nearby devices…");
    await withScanLock(() => this.ble.startScan(onDevice));
  }

  stopBleScan(): void {
    this.ble.stopScan();
  }

  async connectBleToDevice(device: Device): Promise<void> {
    this.log(`BLE: connecting to "${device.name ?? device.localName ?? device.id}"…`);
    await withScanLock(() => this.ble.connectToDevice(device));
    this.log("BLE: connected");
    this.wireBleWifiEvents();
  }

  private wireBleWifiEvents() {
    this.bleUnsub?.();
    this.bleUnsub = this.ble.onMessage((message) => {
      if (isGloveWifiEvent(message)) {
        // ssid is only ever present on a "status" push, per
        // PROTOCOL_GLOVES_UPDATED.md §2.4 -- "down"/"up" carry none.
        this.log(`BLE: wifi event=${message.event} ssid=${message.ssid ?? ""}`);
        this.emit("bleWifiEvent", { event: message.event, ssid: message.ssid ?? null });
      }
    });
    this.bleDisconnectUnsub?.();
    this.bleDisconnectUnsub = this.ble.onDisconnect(() => {
      this.log("BLE: disconnected unexpectedly");
      this.emit("bleDisconnected", {});
    });
  }

  async getBleInfo(): Promise<Record<string, unknown>> {
    const ack = await this.sendBleCommand({ cmd: "info" });
    return (ack.info as Record<string, unknown>) ?? {};
  }

  async setWifiCredentials(ssid: string, key: string): Promise<void> {
    this.log(`BLE: sending wifi credentials (ssid="${ssid}")`);
    await this.sendBleCommand({ cmd: "wifi", ssid, key });
  }

  // Fallback for when the TCP command channel never came up at all (e.g.
  // the Wi-Fi join itself timed out) -- sendCommand()'s own forget_wifi
  // can't reach the glove with no socket to write to, but forget_wifi is
  // also available over BLE (PROTOCOL.md §2.3) and BLE is still connected
  // in exactly this case (the glove only stops advertising once ITS Wi-Fi
  // join *succeeds*, which it never did here). Without this, a failed join
  // leaves the glove holding credentials it was just given and nothing
  // ever tells it to stop retrying them.
  async forgetWifiBle(): Promise<void> {
    this.log("BLE: sending forget_wifi");
    await this.sendBleCommand({ cmd: "forget_wifi" });
  }

  // Not called from the normal hotspot flow -- PROTOCOL_GLOVES_UPDATED.md
  // says to omit app_ip entirely when the glove is joining the phone's own
  // hotspot (the gateway IS the phone already). Kept for the one case where
  // it's still needed: a receiver that isn't the gateway, e.g. a bench-test
  // rig on a shared network. Omit `ip` (or pass null) to clear a previously
  // set override and fall back to auto-targeting the gateway.
  async setAppIp(ip?: string | null): Promise<void> {
    this.log(`BLE: sending app_ip=${ip ?? "(clear override)"}`);
    await this.sendBleCommand({ cmd: "app_ip", ip });
  }

  private sendBleCommand(command: GloveCommand, timeoutMs = 5000): Promise<AckMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`No BLE ack for "${command.cmd}" within ${timeoutMs}ms`));
      }, timeoutMs);
      const unsubscribe = this.ble.onMessage((message) => {
        if (message.type === "ack" && message.cmd === command.cmd) {
          clearTimeout(timer);
          unsubscribe();
          if (message.ok === false) reject(new Error(`${command.cmd} rejected by device`));
          else resolve(message as unknown as AckMessage);
        }
      });
      this.ble.send(command).catch((err) => {
        clearTimeout(timer);
        unsubscribe();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async disconnectBle(): Promise<void> {
    this.bleUnsub?.();
    this.bleUnsub = null;
    this.bleDisconnectUnsub?.();
    this.bleDisconnectUnsub = null;
    await this.ble.disconnect();
  }

  get isBleConnected(): boolean {
    return this.ble.isConnected;
  }

  // -- TCP: command channel (shared port 5010) + data channel (5008) -------

  startTcp() {
    if (this.unregisterCommandPort || this.dataServer) {
      this.log("TCP: startTcp() called again while already listening -- ignoring");
      return;
    }

    this.unregisterCommandPort = sharedCommandPort.register(
      THIS_DEVICE,
      (socket, initialData) => this.handleCommandConnection(socket, initialData),
      (line) => this.log(line)
    );

    this.dataServer = TcpSocket.createServer((socket) => this.handleDataConnection(socket));
    this.dataServer.listen({ port: GLOVE_DATA_PORT, host: "0.0.0.0", reuseAddress: true });

    this.statusWatchdog = setInterval(() => {
      if (this.connected && Date.now() - this.lastStatusAt > STATUS_TIMEOUT_MS) {
        this.connected = false;
        this.log("⚠ no status in 6s -- treating glove as disconnected");
        this.emit("connectionStateChange", { connected: false });
      }
    }, 1000);

    this.log(`TCP: registered on shared command port + listening on ${GLOVE_DATA_PORT} (data)`);
  }

  stopTcp() {
    if (this.statusWatchdog) clearInterval(this.statusWatchdog);
    this.statusWatchdog = null;
    if (this.dataAckTimer) clearInterval(this.dataAckTimer);
    this.dataAckTimer = null;

    if (this.commandSocket) this.safeSocketOp("command", () => this.commandSocket!.destroy());
    if (this.dataSocket) this.safeSocketOp("data", () => this.dataSocket!.destroy());
    this.unregisterCommandPort?.();
    this.unregisterCommandPort = null;
    this.dataServer?.close();
    this.dataServer = null;
    this.commandSocket = null;
    this.dataSocket = null;

    for (const { timer, resolve } of this.pendingAcks.values()) {
      clearTimeout(timer);
      resolve(null);
    }
    this.pendingAcks.clear();

    this.connected = false;
    this.dataBootId = null;
    this.highestDataSeq = -1;
    this.dataBuffer = Buffer.alloc(0);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // Distinct from isConnected: that's a liveness *heuristic* (no status
  // for STATUS_TIMEOUT_MS -- see the watchdog in startTcp()), which can
  // read false while the TCP socket is still physically open (a status
  // message just happened to be late/dropped). Whether there's an actual
  // socket to write to is a separate, simpler fact -- used by
  // GloveSession.returnToBleReady() to decide whether it's even worth
  // trying forget_wifi, rather than trusting the heartbeat to gate a
  // one-shot command it only gets to send once per stop.
  get hasCommandSocket(): boolean {
    return this.commandSocket !== null;
  }

  private handleCommandConnection(socket: TcpSocketInstance, initialData: string) {
    const previous = this.commandSocket;
    this.commandSocket = socket;
    if (previous) this.safeSocketOp("command", () => previous.destroy());
    this.commandBuffer = "";
    this.log("TCP command: glove connected");

    this.consumeCommandChunk(initialData);

    socket.on("data", (data) => {
      const chunk = typeof data === "string" ? data : data.toString("utf8");
      this.consumeCommandChunk(chunk);
    });

    const onClose = (reason: string) => {
      if (this.commandSocket === socket) {
        this.commandSocket = null;
        if (this.connected) {
          this.connected = false;
          this.emit("connectionStateChange", { connected: false });
        }
        this.log(`TCP command: connection closed (${reason})`);
      }
    };
    socket.on("close", () => onClose("close"));
    socket.on("error", (err: unknown) => onClose(`error: ${err}`));
  }

  private consumeCommandChunk(chunk: string) {
    this.commandBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.commandBuffer.indexOf("\n")) !== -1) {
      const line = this.commandBuffer.slice(0, newlineIndex);
      this.commandBuffer = this.commandBuffer.slice(newlineIndex + 1);
      this.handleCommandLine(line);
    }
  }

  private markAlive() {
    this.lastStatusAt = Date.now();
    if (!this.connected) {
      this.connected = true;
      this.emit("connectionStateChange", { connected: true });
    }
  }

  private handleCommandLine(line: string) {
    const message = parseCommandLine(line);
    if (!message) {
      if (line.trim()) this.log(`TCP command: unparsed line: ${JSON.stringify(line).slice(0, 300)}`);
      return;
    }
    this.emit("commandMessage", message);

    switch (message.type) {
      case "hello":
        this.markAlive();
        this.log(`hello: fw=${message.fw} wifi.connected=${message.wifi.connected} reconnected=${message.reconnected}`);
        this.emit("hello", message);
        break;
      case "status":
        this.markAlive();
        this.emit("status", message);
        break;
      case "ack":
        if (typeof message.ref === "number") {
          const pending = this.pendingAcks.get(message.ref);
          if (pending) {
            clearTimeout(pending.timer);
            pending.resolve(message);
            this.pendingAcks.delete(message.ref);
          }
        }
        this.log(`ack cmd=${message.cmd ?? "?"} ok=${message.ok}`);
        break;
    }
  }

  // `info` is BLE-only per PROTOCOL_GLOVE.md (getBleInfo() uses
  // sendBleCommand instead) -- excluded here since it carries no `seq`.
  sendCommand(command: Exclude<GloveCommand, { cmd: "info" }>, timeoutMs = 5000): Promise<AckMessage | null> {
    return new Promise((resolve) => {
      if (!this.commandSocket) {
        this.log(`sendCommand(${command.cmd}): no command connection`);
        resolve(null);
        return;
      }

      // data_ack carries no seq-matched ack per spec -- fire-and-forget.
      if (command.cmd === "data_ack") {
        this.safeSocketOp("command", () => this.commandSocket!.write(buildCommandLine(command)));
        resolve(null);
        return;
      }

      const seq = command.seq ?? this.commandSeq++;
      const line = buildCommandLine({ ...command, seq } as GloveCommand);
      const timer = setTimeout(() => {
        this.pendingAcks.delete(seq);
        this.log(`sendCommand(${command.cmd}, seq=${seq}): no ack within ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs);
      this.pendingAcks.set(seq, { timer, resolve });
      this.safeSocketOp("command", () => this.commandSocket!.write(line));
    });
  }

  // -- Data channel (5008) -- fixed-size binary, no framing/delimiter ------

  private handleDataConnection(socket: TcpSocketInstance) {
    const previous = this.dataSocket;
    this.dataSocket = socket;
    if (previous) this.safeSocketOp("data", () => previous.destroy());
    this.dataBuffer = Buffer.alloc(0);
    // Deliberately no setEncoding() -- every byte here is binary (per
    // PROTOCOL_GLOVE.md §4), so the socket must keep emitting raw Buffers,
    // not have them decoded as UTF-8 text (which would corrupt them).
    this.log("TCP data: glove connected");

    if (this.dataAckTimer) clearInterval(this.dataAckTimer);
    this.dataAckWarned = false;
    this.dataAckTimer = setInterval(() => {
      if (this.highestDataSeq < 0) return;
      // The data channel (this socket) and the command channel are two
      // separate TCP connections -- one can die while the other keeps
      // running. Without this guard, a dead command channel turned this
      // into an infinite "no command connection" log line every 300ms
      // for as long as data kept arriving. Log the transition once, not
      // on every tick; sendCommand() itself is still the one deciding
      // whether to actually attempt the write.
      if (!this.commandSocket) {
        if (!this.dataAckWarned) {
          this.dataAckWarned = true;
          this.log("data_ack: command channel is down -- acks will resume once it reconnects (data keeps arriving meanwhile)");
        }
        return;
      }
      this.dataAckWarned = false;
      this.sendCommand({ cmd: "data_ack", data_seq: this.highestDataSeq });
    }, 300);

    socket.on("data", (data: string | Buffer) => {
      const chunk = typeof data === "string" ? Buffer.from(data, "utf8") : data;
      this.dataBuffer = this.dataBuffer.length === 0 ? chunk : Buffer.concat([this.dataBuffer, chunk]);
      while (this.dataBuffer.length >= GLOVE_WIRE_FRAME_SIZE) {
        const frame = this.dataBuffer.slice(0, GLOVE_WIRE_FRAME_SIZE);
        this.dataBuffer = this.dataBuffer.slice(GLOVE_WIRE_FRAME_SIZE);
        this.handleFrameBytes(frame);
      }
    });

    const onClose = (reason: string) => {
      if (this.dataSocket === socket) {
        this.dataSocket = null;
        if (this.dataAckTimer) clearInterval(this.dataAckTimer);
        this.dataAckTimer = null;
        this.log(`TCP data: connection closed (${reason})`);
      }
    };
    socket.on("close", () => onClose("close"));
    socket.on("error", (err: unknown) => onClose(`error: ${err}`));
  }

  // Reads only the 16 plaintext header bytes (bootId/seq/assembledAtMs) --
  // bytes 16-317 are ciphertext + an HMAC tag this app has no key for (see
  // DATA_ENCRYPTION.md), so the raw `frame` is forwarded unchanged, same
  // "store/forward, never inspect past the header" job tools/glove_fake_app.py
  // demonstrates for the real app side.
  private handleFrameBytes(frame: Buffer) {
    const bootId = frame.readUInt32LE(0);
    const seq = frame.readUInt32LE(4);
    const assembledAtMs = readUInt64LE(frame, 8);

    // §4.2: seq restarting from 0 with the SAME bootId is a replay after
    // reconnect (skip anything already seen); a DIFFERENT bootId means the
    // device rebooted (reset tracking, don't treat it as a gap).
    if (this.dataBootId !== bootId) {
      this.dataBootId = bootId;
      this.highestDataSeq = -1;
    }
    if (seq <= this.highestDataSeq) return;
    this.highestDataSeq = seq;
    this.emit("rawPacket", { bootId, seq, assembledAtMs, frame });
  }

  // Deliberately does NOT call `this.ble.destroy()`. NordicUartLink.destroy()
  // tears down the shared, singleton native BLE client used by every device
  // link in the app (see scan-lock.ts's comment) -- calling it here would
  // kill glasses' BLE too. Only GlassesSession.destroy() does that, tied to
  // the whole app's DeviceProvider unmounting; this only releases what's
  // actually this link's own (its GATT connection, its own sockets/listeners).
  destroy() {
    this.stopTcp();
    this.bleUnsub?.();
    this.bleUnsub = null;
    this.bleDisconnectUnsub?.();
    this.bleDisconnectUnsub = null;
    this.ble.disconnect().catch(() => undefined);
    this.stopHotspot().catch(() => undefined);
  }
}
