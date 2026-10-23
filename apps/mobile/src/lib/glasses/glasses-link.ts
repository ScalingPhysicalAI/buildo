// GlassesLink: BLE setup, the Wi-Fi handoff, and both TCP channels (command
// port 5010, data port 5005) to the capture glasses. Phone-hosted hotspot is
// the normal path; `setAppIp` is only for the fallback where phone and
// glasses join someone else's router instead.
import TcpSocket from "react-native-tcp-socket";

import { startHotspot, stopHotspot, type LocalHotspotReservation } from "./hotspot";
import { NordicUartLink, type Device } from "../ble/nordic-uart-link";
import {
  buildCommandLine,
  buildDataAckLine,
  parseCommandLine,
  parseDataLine,
  type AckMessage,
  type CommandChannelMessage,
  type EpisodeEventMessage,
  type FrameMessage,
  type GlassesCommand,
  type HelloMessage,
  type PeerMessage,
  type StatusMessage,
} from "./protocol";

export const GLASSES_BLE_DEVICE_NAME = "Glasses-L";
export const COMMAND_PORT = 5010;
export const DATA_PORT = 5005;

// Status doubles as a heartbeat -- no status in this long means disconnected.
const STATUS_TIMEOUT_MS = 6000;

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

export interface TimeSyncResult {
  offsetUs: number;
  rttUs: number;
}

interface GlassesLinkEvents {
  log: { line: string };
  bleWifiEvent: Record<string, unknown>;
  hello: HelloMessage;
  status: StatusMessage;
  commandMessage: CommandChannelMessage;
  dataHello: { boot: number; nextSeq: number; resendFrom: number };
  frame: FrameMessage;
  peer: PeerMessage;
  episodeEvent: EpisodeEventMessage;
  connectionStateChange: { connected: boolean };
  bleDisconnected: Record<string, never>;
}

export class GlassesLink extends TinyEmitter<GlassesLinkEvents> {
  private ble = new NordicUartLink();
  private bleUnsub: (() => void) | null = null;
  private bleDisconnectUnsub: (() => void) | null = null;

  private commandServer: InstanceType<typeof TcpSocket.Server> | null = null;
  private dataServer: InstanceType<typeof TcpSocket.Server> | null = null;
  private commandSocket: TcpSocketInstance | null = null;
  private dataSocket: TcpSocketInstance | null = null;
  private commandBuffer = "";
  private dataBuffer = "";

  private commandSeq = 0;
  private pendingAcks = new Map<number, { timer: ReturnType<typeof setTimeout>; resolve: (ack: AckMessage | null) => void }>();
  private pendingPongs = new Map<number, (message: { id: number; t_us: number }) => void>();

  private lastStatusAt = 0;
  private statusWatchdog: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  private dataBoot: number | null = null;
  private highestDataSeq = -1;
  private dataAckTimer: ReturnType<typeof setInterval> | null = null;

  private hotspotActive = false;

  private log(line: string) {
    this.emit("log", { line });
  }

  // A call on an already-torn-down native socket throws an uncatchable
  // "IllegalArgumentException: No socket with id N" that crashes the app --
  // this keeps that from taking the app down with it.
  private safeSocketOp(label: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.log(`TCP ${label}: ignored (socket already gone) -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -- Phone-hosted hotspot (the normal case) -------------------------------

  async startHotspot(): Promise<LocalHotspotReservation> {
    this.log("Hotspot: starting…");
    const reservation = await startHotspot();
    this.hotspotActive = true;
    this.log(`Hotspot: up, ssid="${reservation.ssid}" gateway=${reservation.gatewayIp}`);
    return reservation;
  }

  async stopHotspot(): Promise<void> {
    if (!this.hotspotActive) return;
    await stopHotspot();
    this.hotspotActive = false;
    this.log("Hotspot: stopped");
  }

  // -- BLE setup (Nordic UART, "Glasses-L") --------------------------------

  async connectBle(timeoutMs = 10000): Promise<void> {
    this.log(`BLE: scanning for "${GLASSES_BLE_DEVICE_NAME}"…`);
    await this.ble.connectByName(GLASSES_BLE_DEVICE_NAME, timeoutMs);
    this.log("BLE: connected");
    this.wireBleWifiEvents();
  }

  // Unfiltered scan, for when connectBle() can't find the board by name.
  async startBleScan(onDevice: (device: Device) => void): Promise<void> {
    this.log("BLE: scanning for all nearby devices…");
    await this.ble.startScan(onDevice);
  }

  stopBleScan(): void {
    this.ble.stopScan();
  }

  async connectBleToDevice(device: Device): Promise<void> {
    this.log(`BLE: connecting to "${device.name ?? device.localName ?? device.id}"…`);
    await this.ble.connectToDevice(device);
    this.log("BLE: connected");
    this.wireBleWifiEvents();
  }

  private wireBleWifiEvents() {
    this.bleUnsub?.();
    this.bleUnsub = this.ble.onMessage((message) => {
      if (message.type === "wifi") {
        this.log(`BLE: wifi event=${message.event} status=${message.status ?? ""}`);
        this.emit("bleWifiEvent", message);
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

  // Fallback path only -- omitting `app_ip` tells the glasses to use the
  // hotspot gateway (the phone itself).
  async setAppIp(ip: string): Promise<void> {
    this.log(`BLE: sending app_ip=${ip}`);
    await this.sendBleCommand({ cmd: "app_ip", ip });
  }

  private sendBleCommand(command: Record<string, unknown>, timeoutMs = 5000): Promise<AckMessage> {
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

  // -- TCP: command channel (5010) + data channel (5005) -------------------
  // Both must be listening before the glasses' Wi-Fi comes up -- the board
  // is always the client here and dials out on its own as soon as it joins.

  startTcp() {
    // Guards against ever double-binding the command/data ports.
    if (this.commandServer || this.dataServer) {
      this.log("TCP: startTcp() called again while already listening -- ignoring");
      return;
    }
    this.commandServer = TcpSocket.createServer((socket) => this.handleCommandConnection(socket));
    this.commandServer.listen({ port: COMMAND_PORT, host: "0.0.0.0", reuseAddress: true });

    this.dataServer = TcpSocket.createServer((socket) => this.handleDataConnection(socket));
    this.dataServer.listen({ port: DATA_PORT, host: "0.0.0.0", reuseAddress: true });

    this.statusWatchdog = setInterval(() => {
      if (this.connected && Date.now() - this.lastStatusAt > STATUS_TIMEOUT_MS) {
        this.connected = false;
        this.log("⚠ no status in 6s -- treating glasses as disconnected");
        this.emit("connectionStateChange", { connected: false });
      }
    }, 1000);

    this.log(`TCP: listening on ${COMMAND_PORT} (command) + ${DATA_PORT} (data)`);
  }

  stopTcp() {
    if (this.statusWatchdog) clearInterval(this.statusWatchdog);
    this.statusWatchdog = null;
    if (this.dataAckTimer) clearInterval(this.dataAckTimer);
    this.dataAckTimer = null;

    if (this.commandSocket) this.safeSocketOp("command", () => this.commandSocket!.destroy());
    if (this.dataSocket) this.safeSocketOp("data", () => this.dataSocket!.destroy());
    this.commandServer?.close();
    this.dataServer?.close();
    this.commandServer = null;
    this.dataServer = null;
    this.commandSocket = null;
    this.dataSocket = null;

    for (const { timer, resolve } of this.pendingAcks.values()) {
      clearTimeout(timer);
      resolve(null);
    }
    this.pendingAcks.clear();
    this.pendingPongs.clear();

    this.connected = false;
    this.dataBoot = null;
    this.highestDataSeq = -1;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private handleCommandConnection(socket: TcpSocketInstance) {
    const previous = this.commandSocket;
    this.commandSocket = socket;
    if (previous) this.safeSocketOp("command", () => previous.destroy());
    this.commandBuffer = "";
    socket.setEncoding("utf8");
    this.log("TCP command: glasses connected");

    socket.on("data", (data) => {
      const chunk = typeof data === "string" ? data : data.toString("utf8");
      // Raw, unconditional -- proves what actually hit the socket, not just what the board claims to have sent.
      this.log(`TCP command: recv ${chunk.length}B: ${JSON.stringify(chunk).slice(0, 300)}`);
      this.commandBuffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = this.commandBuffer.indexOf("\n")) !== -1) {
        const line = this.commandBuffer.slice(0, newlineIndex);
        this.commandBuffer = this.commandBuffer.slice(newlineIndex + 1);
        this.handleCommandLine(line);
      }
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
    // Separate from "close" so a silently-failed write surfaces as an error, not silence.
    socket.on("error", (err: unknown) => onClose(`error: ${err}`));
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
        this.log(`hello: fw=${message.fw} ip=${message.ip} state=${message.state} reconnected=${message.reconnected}`);
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
        this.log(`ack cmd=${message.cmd ?? "?"} ok=${message.ok}${message.error ? ` error=${message.error}` : ""}`);
        break;
      case "pong": {
        const resolve = this.pendingPongs.get(message.id);
        if (resolve) {
          resolve(message);
          this.pendingPongs.delete(message.id);
        }
        break;
      }
      case "peer":
        this.log(`peer: side=${message.side} ok=${message.ok} rtsp=${message.rtsp ?? "none"}`);
        this.emit("peer", message);
        break;
      case "episode":
        this.log(`episode event=${message.event} ep=${message.ep}`);
        this.emit("episodeEvent", message);
        break;
    }
  }

  // Sends a command and resolves with its ack. `reconnect`/`sync_end`/`ping`
  // don't carry a seq-matched ack per spec, so those are fire-and-forget.
  sendCommand(command: GlassesCommand, timeoutMs = 5000): Promise<AckMessage | null> {
    return new Promise((resolve) => {
      if (!this.commandSocket) {
        this.log(`sendCommand(${command.cmd}): no command connection`);
        resolve(null);
        return;
      }

      if (command.cmd === "reconnect" || command.cmd === "sync_end" || command.cmd === "ping") {
        this.safeSocketOp("command", () => this.commandSocket!.write(buildCommandLine(command)));
        resolve(null);
        return;
      }

      const seq = command.seq ?? this.commandSeq++;
      const line = buildCommandLine({ ...command, seq } as GlassesCommand);
      const timer = setTimeout(() => {
        this.pendingAcks.delete(seq);
        this.log(`sendCommand(${command.cmd}, seq=${seq}): no ack within ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs);
      this.pendingAcks.set(seq, { timer, resolve });
      this.safeSocketOp("command", () => this.commandSocket!.write(line));
    });
  }

  private sendPing(id: number): Promise<{ id: number; t_us: number } | null> {
    return new Promise((resolve) => {
      if (!this.commandSocket) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => {
        this.pendingPongs.delete(id);
        resolve(null);
      }, 2000);
      this.pendingPongs.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.safeSocketOp("command", () => this.commandSocket!.write(buildCommandLine({ cmd: "ping", id })));
    });
  }

  // One sync ack, one burst of pings, keep the smallest-RTT sample, send
  // sync_end -- the mechanics from EPISODES.md §6. Doesn't check the result
  // against any threshold; runTimeSync() below does that.
  private async runTimeSyncOnce(pingCount: number): Promise<TimeSyncResult | null> {
    const syncAck = await this.sendCommand({ cmd: "sync" });
    if (!syncAck?.ok) {
      this.log("time sync: sync command not acked");
      return null;
    }

    let best: { rtt: number; offset: number } | null = null;
    for (let i = 0; i < pingCount; i++) {
      const t0 = Date.now() * 1000; // µs; Date.now() ms resolution is the best clock RN JS exposes here
      const pong = await this.sendPing(i);
      const t1 = Date.now() * 1000;
      if (!pong) continue;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) {
        best = { rtt, offset: pong.t_us - (t0 + t1) / 2 };
      }
    }

    if (!best) {
      this.log("time sync: no pongs received");
      return null;
    }

    await this.sendCommand({ cmd: "sync_end", offset_us: best.offset, rtt_us: best.rtt });
    this.log(`time sync: offset=${Math.round(best.offset)}µs rtt=${Math.round(best.rtt)}µs`);
    return { offsetUs: best.offset, rttUs: best.rtt };
  }

  // EPISODES.md §3 step 2: burst of 30 pings, best RTT <= 20ms, retry up to
  // 3 times, refuse if it never gets there.
  private static readonly SYNC_RTT_THRESHOLD_US = 20_000;

  async runTimeSync(pingCount = 30, attempts = 3): Promise<TimeSyncResult | null> {
    let lastResult: TimeSyncResult | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await this.runTimeSyncOnce(pingCount);
      if (result && result.rttUs <= GlassesLink.SYNC_RTT_THRESHOLD_US) return result;
      lastResult = result;
      if (result) {
        this.log(
          `time sync: attempt ${attempt}/${attempts} rtt=${Math.round(result.rttUs)}µs over the ${GlassesLink.SYNC_RTT_THRESHOLD_US / 1000}ms threshold`
        );
      }
    }
    if (!lastResult) return null;
    this.log(`time sync: never reached a best RTT ≤ ${GlassesLink.SYNC_RTT_THRESHOLD_US / 1000}ms after ${attempts} tries -- Wi-Fi too slow for good timing`);
    return null;
  }

  // -- Data channel (5005) --------------------------------------------------

  private handleDataConnection(socket: TcpSocketInstance) {
    const previous = this.dataSocket;
    this.dataSocket = socket;
    if (previous) this.safeSocketOp("data", () => previous.destroy());
    this.dataBuffer = "";
    socket.setEncoding("utf8");
    this.log("TCP data: glasses connected");

    if (this.dataAckTimer) clearInterval(this.dataAckTimer);
    this.dataAckTimer = setInterval(() => {
      if (this.highestDataSeq >= 0 && this.dataSocket) {
        this.safeSocketOp("data", () => this.dataSocket!.write(buildDataAckLine(this.highestDataSeq)));
      }
    }, 300);

    socket.on("data", (data) => {
      this.dataBuffer += typeof data === "string" ? data : data.toString("utf8");
      let newlineIndex: number;
      while ((newlineIndex = this.dataBuffer.indexOf("\n")) !== -1) {
        const line = this.dataBuffer.slice(0, newlineIndex);
        this.dataBuffer = this.dataBuffer.slice(newlineIndex + 1);
        this.handleDataLine(line);
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

  private handleDataLine(line: string) {
    const message = parseDataLine(line);
    if (!message) return;

    if (message.type === "data_hello") {
      if (this.dataBoot !== message.boot) {
        this.dataBoot = message.boot; // new boot -- seq restarts from 0
        this.highestDataSeq = -1;
      }
      this.log(`data_hello: boot=${message.boot} next_seq=${message.next_seq} resend_from=${message.resend_from}`);
      this.emit("dataHello", { boot: message.boot, nextSeq: message.next_seq, resendFrom: message.resend_from });
      return;
    }

    if (message.type === "episode") {
      this.log(`data episode marker: ${message.event} ep=${message.ep}`);
      return;
    }

    // frame -- skip anything already seen (duplicate/replay), per spec.
    if (message.seq <= this.highestDataSeq) return;
    this.highestDataSeq = message.seq;
    this.emit("frame", message);
  }

  destroy() {
    this.stopTcp();
    this.ble.destroy();
    this.stopHotspot().catch(() => undefined);
  }
}
