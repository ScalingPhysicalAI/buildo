// Phone-side TCP server for the glasses master board, per "Glasses
// Integration: Packet Spec". The phone is always the server; the board is
// always the client and drives all reconnection, so these listeners must
// stay open for the app's whole lifetime and silently accept new
// connections -- never require a restart.
import TcpSocket from "react-native-tcp-socket";

import {
  buildCommandLine,
  FRAME_HEADER_SIZE,
  parseBoardLine,
  parseFrameHeader,
  type BoardMessage,
  type FrameHeader,
  type GlassesCommand,
} from "./protocol";

export const CONTROL_PORT = 5005;
export const LEFT_FRAME_PORT = 5006;

type TcpSocketInstance = InstanceType<typeof TcpSocket.Socket>;

export interface GlassesFrame {
  header: FrameHeader;
  jpeg: Uint8Array;
  receivedAt: number;
}

interface GlassesLinkEvents {
  message: { message: BoardMessage; receivedAt: number };
  frame: GlassesFrame;
  controlConnected: undefined;
  controlDisconnected: undefined;
  seqGap: { type: BoardMessage["type"]; previous: number; current: number };
}

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

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class GlassesLink extends TinyEmitter<GlassesLinkEvents> {
  private controlServer: InstanceType<typeof TcpSocket.Server> | null = null;
  private frameServer: InstanceType<typeof TcpSocket.Server> | null = null;
  private controlSocket: TcpSocketInstance | null = null;
  private controlBuffer = "";
  private frameSocket: TcpSocketInstance | null = null;
  private frameBuffer: Uint8Array = new Uint8Array(0);
  private lastSeqByType = new Map<BoardMessage["type"], number>();
  private commandSeq = 0;
  private pendingAcks = new Map<number, { timer: ReturnType<typeof setTimeout>; resolve: (ok: boolean) => void }>();

  start() {
    this.controlServer = TcpSocket.createServer((socket) => this.handleControlConnection(socket));
    this.controlServer.listen({ port: CONTROL_PORT, host: "0.0.0.0", reuseAddress: true });

    this.frameServer = TcpSocket.createServer((socket) => this.handleFrameConnection(socket));
    this.frameServer.listen({ port: LEFT_FRAME_PORT, host: "0.0.0.0", reuseAddress: true });
  }

  stop() {
    this.controlSocket?.destroy();
    this.frameSocket?.destroy();
    this.controlServer?.close();
    this.frameServer?.close();
    this.controlServer = null;
    this.frameServer = null;
    this.controlSocket = null;
    this.frameSocket = null;
    for (const { timer, resolve } of this.pendingAcks.values()) {
      clearTimeout(timer);
      resolve(false);
    }
    this.pendingAcks.clear();
  }

  get isControlConnected() {
    return this.controlSocket !== null;
  }

  sendCommand(command: GlassesCommand, timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.controlSocket) {
        resolve(false);
        return;
      }
      const seq = this.commandSeq++;
      const timer = setTimeout(() => {
        this.pendingAcks.delete(seq);
        resolve(false); // no ack within 3s -- per spec, treat the command as failed
      }, timeoutMs);
      this.pendingAcks.set(seq, { timer, resolve });
      this.controlSocket.write(buildCommandLine(command, seq));
    });
  }

  private handleControlConnection(socket: TcpSocketInstance) {
    // Board reconnects on its own; only the newest connection is authoritative.
    this.controlSocket?.destroy();
    this.controlSocket = socket;
    this.controlBuffer = "";
    this.lastSeqByType.clear();
    socket.setEncoding("utf8");
    this.emit("controlConnected", undefined);

    socket.on("data", (data) => {
      this.controlBuffer += typeof data === "string" ? data : data.toString("utf8");
      let newlineIndex: number;
      while ((newlineIndex = this.controlBuffer.indexOf("\n")) !== -1) {
        const line = this.controlBuffer.slice(0, newlineIndex);
        this.controlBuffer = this.controlBuffer.slice(newlineIndex + 1);
        this.handleControlLine(line);
      }
    });

    const onClose = () => {
      if (this.controlSocket === socket) {
        this.controlSocket = null;
        this.emit("controlDisconnected", undefined);
      }
    };
    socket.on("close", onClose);
    socket.on("error", onClose);
  }

  private handleControlLine(line: string) {
    const message = parseBoardLine(line);
    if (!message) return; // malformed line -- drop it, board keeps sending regardless

    const previousSeq = this.lastSeqByType.get(message.type);
    if (previousSeq !== undefined && message.seq - previousSeq > 1) {
      this.emit("seqGap", { type: message.type, previous: previousSeq, current: message.seq });
    }
    this.lastSeqByType.set(message.type, message.seq);

    if (message.type === "ack") {
      const pending = this.pendingAcks.get(message.ref);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(message.ok);
        this.pendingAcks.delete(message.ref);
      }
    }

    this.emit("message", { message, receivedAt: Date.now() });
  }

  private handleFrameConnection(socket: TcpSocketInstance) {
    this.frameSocket?.destroy();
    this.frameSocket = socket;
    this.frameBuffer = new Uint8Array(0);

    socket.on("data", (data) => {
      const chunk = typeof data === "string" ? new TextEncoder().encode(data) : data;
      this.frameBuffer = concatBuffers(this.frameBuffer, chunk);
      this.drainFrameBuffer(socket);
    });

    const onClose = () => {
      if (this.frameSocket === socket) {
        this.frameSocket = null;
        this.frameBuffer = new Uint8Array(0);
      }
    };
    socket.on("close", onClose);
    socket.on("error", onClose);
  }

  private drainFrameBuffer(socket: TcpSocketInstance) {
    for (;;) {
      if (this.frameBuffer.length < FRAME_HEADER_SIZE) return;
      const header = parseFrameHeader(this.frameBuffer);
      if (!header) {
        // Bad magic -- per spec, close the connection; the board reconnects.
        socket.destroy();
        this.frameBuffer = new Uint8Array(0);
        return;
      }
      const totalLength = FRAME_HEADER_SIZE + header.length;
      if (this.frameBuffer.length < totalLength) return; // wait for the rest of the JPEG

      const jpeg = this.frameBuffer.slice(FRAME_HEADER_SIZE, totalLength);
      this.emit("frame", { header, jpeg, receivedAt: Date.now() });
      this.frameBuffer = this.frameBuffer.slice(totalLength);
    }
  }
}
