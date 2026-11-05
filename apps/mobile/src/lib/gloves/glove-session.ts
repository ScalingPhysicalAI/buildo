// GloveSession: the glove's BLE-idle -> Wi-Fi -> streaming -> BLE-idle
// lifecycle, mirroring GlassesSession's shape -- and, per
// PROTOCOL_GLOVES_UPDATED.md, now actually following the *same* rules as
// glasses, not the simplified ones the first (now outdated) version of the
// glove protocol had:
//   - The glove now has a real `start`/`stop`/episode concept (§3.5), same
//     as glasses -- the data channel sends nothing until `start` is acked,
//     and `stop` is a real command, not just "drop the hotspot and hope".
//   - `forget_wifi` now exists for the glove too (§2.3/§3.2) -- used the
//     same way glasses uses it, to send it back to BLE advertising on a
//     clean, acked handoff instead of just silently killing the AP.
//   - `app_ip` is now optional, like glasses: omit it when the glove is
//     joining the phone's own hotspot (the normal case, where the gateway
//     IS the phone) -- only needed for a receiver that isn't the gateway.
// Same reasoning as glasses-session.ts for BLE being 100% manual, never
// auto-reconnected in the background while Wi-Fi is active: it would
// compete with the hotspot for radio time.
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { GloveLink } from "./glove-link";
import { DeviceNotFoundError, type Device } from "../ble/nordic-uart-link";
import type { AckMessage, GloveCommand } from "./protocol";

const KEEP_AWAKE_TAG = "gloves-wifi-session";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GloveSessionState =
  | "idle"
  | "connecting_ble"
  | "ble_ready"
  | "ble_disconnected"
  | "starting_wifi"
  | "streaming"
  | "stopping";

export const GLOVE_STATE_LABEL: Record<GloveSessionState, string> = {
  idle: "Not started",
  connecting_ble: "Connecting over Bluetooth…",
  ble_ready: "Connected (Bluetooth only, idle)",
  ble_disconnected: "Disconnected (manual) -- press Connect BLE",
  starting_wifi: "Starting Wi-Fi…",
  streaming: "Streaming (Wi-Fi active)",
  stopping: "Stopping…",
};

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

interface SessionEvents {
  state: { state: GloveSessionState };
  log: { line: string };
  bleConnectError: { notFound: boolean; message: string };
}

// No protocol-specified value for how long the glove's own Wi-Fi join may
// take -- reusing the same window glasses' own board needs on the same
// phone-hosted hotspot, since it's the same underlying Android Wi-Fi join
// process, not a glove-specific number from the doc.
const WIFI_JOIN_TIMEOUT_MS = 25000;

export class GloveSession extends TinyEmitter<SessionEvents> {
  readonly link = new GloveLink();

  private _state: GloveSessionState = "idle";
  private destroyed = false;
  private currentEpisode: string | null = null;

  private pendingAbort: { aborted: boolean; promise: Promise<never>; abort: () => void } | null = null;

  constructor() {
    super();
    this.link.on("log", ({ line }) => this.emit("log", { line }));
    this.link.on("bleDisconnected", () => {
      this.emit("log", { line: "glove session: BLE disconnected" });
      if (this._state !== "streaming" && this._state !== "starting_wifi" && this._state !== "stopping") {
        this.setState("ble_disconnected");
      }
    });
    this.link.on("connectionStateChange", ({ connected }) => {
      if (!connected && (this._state === "streaming" || this._state === "starting_wifi")) {
        this.emit("log", { line: "glove session: Wi-Fi/TCP link dropped unexpectedly -- cleaning up" });
        this.pendingAbort?.abort();
        this.returnToBleReady().catch(() => undefined);
      }
    });
  }

  get state(): GloveSessionState {
    return this._state;
  }

  private setState(state: GloveSessionState) {
    this._state = state;
    this.emit("state", { state });
  }

  start() {
    this.link.startTcp();
  }

  async connectBleManually(): Promise<void> {
    this.setState("connecting_ble");
    try {
      await this.link.connectBle(10000);
      this.setState("ble_ready");
    } catch (err) {
      this.emit("log", { line: `glove session: BLE connect failed (${err instanceof Error ? err.message : String(err)})` });
      this.emit("bleConnectError", {
        notFound: err instanceof DeviceNotFoundError,
        message: err instanceof Error ? err.message : String(err),
      });
      this.setState("ble_disconnected");
    }
  }

  async connectBleToDeviceManually(device: Device): Promise<void> {
    this.setState("connecting_ble");
    try {
      await this.link.connectBleToDevice(device);
      this.setState("ble_ready");
    } catch (err) {
      this.setState("ble_disconnected");
      throw err;
    }
  }

  async disconnectBleManually(): Promise<void> {
    this.emit("log", { line: "glove session: disconnecting BLE (manual)…" });
    await this.link.disconnectBle();
    this.setState("ble_disconnected");
  }

  private beginAbortable(): { aborted: boolean; promise: Promise<never>; abort: () => void } {
    let reject!: (err: Error) => void;
    const promise = new Promise<never>((_, rej) => {
      reject = rej;
    });
    const signal = {
      aborted: false,
      promise,
      abort: () => {
        signal.aborted = true;
        reject(new Error("glove Wi-Fi start was cancelled"));
      },
    };
    this.pendingAbort = signal;
    return signal;
  }

  private raceAbort<T>(promise: Promise<T>, signal: { promise: Promise<never> }): Promise<T> {
    return Promise.race([promise, signal.promise]);
  }

  // Brings the glove onto the shared hotspot, waits for its hello, then
  // arms data capture with `start` -- exactly glasses' own
  // hotspot -> credentials -> hello -> start shape (minus glasses' video
  // command and time-sync, which have no glove equivalent). Safe to call
  // whether or not glasses is also sharing this hotspot -- see
  // shared-hotspot.ts's reference counting.
  async startRecording(episodeName: string): Promise<void> {
    if (this._state !== "ble_ready") {
      throw new Error(`Can't start the glove's Wi-Fi from state "${this._state}" -- wait for "ble_ready" first.`);
    }
    const abort = this.beginAbortable();
    this.setState("starting_wifi");
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    try {
      const reservation = await this.raceAbort(this.link.startHotspot(), abort);
      // No app_ip: the phone is the gateway, and PROTOCOL_GLOVES_UPDATED.md
      // says to skip this entirely in that case -- the glove auto-targets
      // the Wi-Fi gateway on its own (same reasoning as glasses' own
      // startRecording()).
      await this.raceAbort(this.link.setWifiCredentials(reservation.ssid, reservation.password), abort);
      await this.raceAbort(this.waitForHello(WIFI_JOIN_TIMEOUT_MS), abort);
      const ack = await this.raceAbort(this.link.sendCommand({ cmd: "start", episode: episodeName }), abort);
      if (!ack?.ok) {
        if (ack) throw new Error(`start rejected: ${ack.error ?? "unknown reason"}`);
        throw new Error("start: no ack from the glove");
      }
      this.currentEpisode = episodeName;
      this.setState("streaming");
    } catch (err) {
      if (abort.aborted) {
        this.link.stopHotspot().catch(() => undefined);
        return;
      }
      this.emit("log", {
        line: `glove session: starting Wi-Fi failed (${err instanceof Error ? err.message : String(err)}) -- releasing hotspot, back to BLE`,
      });
      await this.returnToBleReady();
      throw err;
    } finally {
      if (this.pendingAbort === abort) this.pendingAbort = null;
    }
  }

  async stopRecording(episodeName: string): Promise<void> {
    if (this._state === "idle" || this._state === "connecting_ble" || this._state === "ble_ready" || this._state === "stopping") {
      return; // nothing in flight to stop
    }
    this.pendingAbort?.abort();
    this.setState("stopping");
    this.emit("log", { line: `glove session: stop(${episodeName})` });
    await this.link.sendCommand({ cmd: "stop", episode: episodeName }, 5000);
    await this.returnToBleReady();
  }

  // Sends `forget_wifi` so the glove gets a real, acked handoff back to BLE
  // advertising, same as glasses -- not just silently killing the AP and
  // waiting an unspecified amount of time for the glove to notice on its
  // own. The settling gap before it mirrors glasses' own (forget_wifi right
  // after stop's ack can still be refused if the board hasn't fully
  // settled out of "recording" yet) -- not spelled out in
  // PROTOCOL_GLOVES_UPDATED.md for the glove specifically, but cheap
  // insurance given the two protocols otherwise behave identically here.
  private async returnToBleReady(): Promise<void> {
    this.currentEpisode = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);

    // Gated on hasCommandSocket, not isConnected: isConnected is a 6s
    // heartbeat heuristic that can already read false (no status/hello
    // recently) while the TCP socket is still open -- gating this one-shot
    // command on that heuristic was silently skipping forget_wifi whenever
    // the heartbeat happened to be stale right when Stop was pressed. The
    // underlying write still goes through sendCommand()'s own "no socket"
    // check either way, so this only changes whether we bother trying.
    if (this.link.hasCommandSocket) {
      await sleep(1000);
      this.emit("log", { line: "glove session: forget_wifi" });
      const ack = await this.link.sendCommand({ cmd: "forget_wifi" }, 3000);
      if (!ack?.ok) {
        this.emit("log", {
          line: `glove session: forget_wifi ${ack ? `rejected (${ack.error ?? "unknown reason"})` : "got no ack"} -- dropping the hotspot anyway`,
        });
      }
    } else if (this.link.isBleConnected) {
      // The Wi-Fi/TCP join never came up at all (e.g. it timed out) -- no
      // command socket to send forget_wifi over, but BLE is still
      // connected, so use that instead (see GloveLink.forgetWifiBle's own
      // comment). Without this, the hotspot gets released below while the
      // glove still holds the credentials it was just given and keeps
      // retrying them in the background indefinitely.
      this.emit("log", { line: "glove session: forget_wifi (over BLE -- Wi-Fi/TCP never came up)" });
      try {
        await this.link.forgetWifiBle();
      } catch (err) {
        this.emit("log", {
          line: `glove session: forget_wifi over BLE failed (${err instanceof Error ? err.message : String(err)}) -- dropping the hotspot anyway`,
        });
      }
    }
    await this.link.stopHotspot().catch(() => undefined);

    if (!this.link.isBleConnected) {
      this.setState("connecting_ble");
      try {
        await this.link.connectBle(10000);
      } catch (err) {
        this.emit("log", {
          line: `glove session: BLE reconnect after stop failed (${err instanceof Error ? err.message : String(err)}) -- press Connect BLE`,
        });
        this.setState("ble_disconnected");
        return;
      }
    }
    this.setState("ble_ready");
  }

  sendCommand(command: Exclude<GloveCommand, { cmd: "info" }>, timeoutMs?: number): Promise<AckMessage | null> {
    return this.link.sendCommand(command, timeoutMs);
  }

  private waitForHello(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error("timed out waiting for the glove to join Wi-Fi and say hello"));
      }, timeoutMs);
      const unsub = this.link.on("hello", () => {
        clearTimeout(timer);
        unsub();
        resolve();
      });
    });
  }

  // Mirrors GlassesSession.destroy(): on a graceful exit while an episode
  // is active, send a real stop + forget_wifi first so the glove closes the
  // episode out cleanly, instead of just yanking the hotspot out from under
  // it (which looks identical to a crash from the glove's point of view).
  destroy() {
    this.destroyed = true;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    this.pendingAbort?.abort();

    const wasActive = this._state === "streaming" || this._state === "starting_wifi";
    if (wasActive && this.currentEpisode) {
      const episode = this.currentEpisode;
      this.emit("log", { line: `glove session: destroy() while active -- sending stop(${episode}) + forget_wifi before tearing down` });
      this.link
        .sendCommand({ cmd: "stop", episode }, 2000)
        .then(() => sleep(1000))
        .then(() => this.link.sendCommand({ cmd: "forget_wifi" }, 2000))
        .catch(() => undefined)
        .finally(() => this.link.destroy());
      return;
    }
    this.link.destroy();
  }
}
