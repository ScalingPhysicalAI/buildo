// GlassesSession: the real product flow, not the manual step-by-step one.
// BLE is the default connection; Wi-Fi only exists for the duration of a
// recording: starting a recording brings the phone's hotspot up and sends
// its (freshly-generated, see startRecording()'s comment) credentials over
// BLE; stopping a recording sends stop, then forget_wifi, then tears the
// hotspot down -- the board switches back to BLE advertising on its own
// once forget_wifi lands.
//
// BLE connect/disconnect is 100% manual (connectBleManually()/
// disconnectBleManually()), including the very first connect -- there is NO
// automatic BLE connect or reconnect anywhere in this file, on purpose. An
// earlier version auto-reconnected BLE in the background on any drop, which
// seemed like the obviously-friendly thing to do; the device's own logs
// (2026-10-21) instead showed that reconnect loop actively colliding with
// the phone's Wi-Fi hotspot for radio time, reliably killing every
// recording's Wi-Fi link about a minute in. Don't reintroduce it without
// that radio-contention problem solved first.
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { GlassesLink, type TimeSyncResult } from "./glasses-link";
import { DeviceNotFoundError, type Device } from "../ble/nordic-uart-link";
import type { AckMessage, GlassesCommand } from "./protocol";

// Both test runs that first exposed this ("hello" confirmed sent by the
// board's own firmware logs, Wi-Fi still dropped ~28s later with
// "network-not-found" -- i.e. the phone's hotspot itself vanished, not a
// rejected reconnect) died at almost exactly the same offset, which lines
// up with a default Android screen-off timer, not anything in this file:
// nothing here has a ~28s timer, and status/hello/ack traffic was flowing
// right up to the drop. Screen-off can throttle the JS thread and/or the
// LocalOnlyHotspot it owns. Holding a wake lock for the whole Wi-Fi-up
// window (hotspot up through back to BLE) removes that as a variable.
const KEEP_AWAKE_TAG = "glasses-wifi-session";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SessionState =
  | "idle" // start() not called yet
  | "connecting_ble"
  | "ble_ready" // BLE connected, no Wi-Fi/hotspot -- the resting state
  | "ble_disconnected" // manually disconnected via disconnectBleManually(); auto-reconnect paused
  | "starting_wifi" // hotspot up, credentials sent, waiting for the board to join + say hello
  | "recording"
  | "stopping";

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
  state: { state: SessionState };
  log: { line: string };
  // Purely additive, on top of the existing "log" line -- lets a caller
  // (the Gadgets screen) show a specific, user-facing reason instead of
  // just silently reverting to "disconnected" with no explanation.
  bleConnectError: { notFound: boolean; message: string };
}

const WIFI_JOIN_TIMEOUT_MS = 25000; // board auto-retries for ~30s before giving up (PROTOCOL_GLASSES.md)

export class GlassesSession extends TinyEmitter<SessionEvents> {
  // Exposed directly -- the debug screen attaches its own listeners here for
  // hello/status/frame/peer/episodeEvent, so this class doesn't need to
  // re-plumb every single GlassesLink event through itself.
  readonly link = new GlassesLink();

  private _state: SessionState = "idle";
  private destroyed = false;
  private currentEpisode: string | null = null;
  // The phone's own IP on the hotspot it just started -- the debug screen
  // threads this into RtspJpegClient as localAddress, forcing the RTSP TCP
  // connect out the hotspot's interface specifically. See rtsp-client.ts's
  // constructor comment for why that's required at all.
  private hotspotGatewayIp: string | null = null;

  // Confirmed from the HW team's own device logs (2026-10-21): this board's
  // BLE connection drops the instant Wi-Fi comes up (ble=off right after
  // "wifi: connected"), which is real hardware behavior, not a bug. The
  // session used to treat that as "unexpected" and immediately scan +
  // reconnect over BLE in the background to "fix" it -- but that BLE
  // scan/connect activity itself competes for radio time with the phone's
  // own Wi-Fi hotspot, and the same logs show the Wi-Fi link dying entirely
  // about a minute into every recording, every single time, which lines up
  // exactly with this loop retrying every 3s the whole time. No automatic
  // BLE connect/reconnect exists anymore, anywhere, for any reason -- BLE is
  // 100% user-triggered now (connectBleManually()/disconnectBleManually()),
  // including the very first connect when the screen opens.
  constructor() {
    super();
    this.link.on("log", ({ line }) => this.emit("log", { line }));
    this.link.on("bleDisconnected", () => {
      this.emit("log", { line: "session: BLE disconnected" });
      if (this._state !== "recording" && this._state !== "starting_wifi" && this._state !== "stopping") {
        this.setState("ble_disconnected");
      }
    });
    this.link.on("connectionStateChange", ({ connected }) => {
      if (!connected && (this._state === "recording" || this._state === "starting_wifi")) {
        // This used to just log and otherwise do nothing, which left the
        // session stuck showing "Recording" forever with frozen stale data
        // if the link ever actually died mid-episode -- exactly what the
        // device logs showed happening (the board detects this itself and
        // auto-stops the episode as "app_lost" on its own side; the app
        // needs to notice the same thing on its side instead of pretending
        // nothing happened). Cleans up the same way a normal Stop would,
        // minus the stop/forget_wifi commands -- there's no live command
        // channel left to send them on.
        this.emit("log", { line: "session: Wi-Fi/TCP link dropped unexpectedly -- cleaning up" });
        this.pendingAbort?.abort();
        this.returnToBleReady().catch(() => undefined);
      }
    });
  }

  get state(): SessionState {
    return this._state;
  }

  get gatewayIp(): string | null {
    return this.hotspotGatewayIp;
  }

  private setState(state: SessionState) {
    this._state = state;
    this.emit("state", { state });
  }

  // Call once (e.g. on screen mount). Starts the TCP listeners only -- the
  // board may dial in at any time, so these need to be up regardless of
  // whether/when BLE gets connected. Does NOT touch BLE at all; see the
  // constructor's comment for why that's no longer automatic.
  start() {
    this.link.startTcp();
  }

  async connectBleManually(): Promise<void> {
    this.setState("connecting_ble");
    try {
      await this.link.connectBle(10000);
      this.setState("ble_ready");
    } catch (err) {
      this.emit("log", { line: `session: BLE connect failed (${err instanceof Error ? err.message : String(err)})` });
      // DeviceNotFoundError specifically means the scan timed out without
      // ever seeing "Glasses-L" -- distinct from, say, a permission denial
      // or the BLE adapter being off, and the one case worth a specific,
      // actionable message rather than a generic "couldn't connect."
      this.emit("bleConnectError", {
        notFound: err instanceof DeviceNotFoundError,
        message: err instanceof Error ? err.message : String(err),
      });
      this.setState("ble_disconnected");
    }
  }

  // Advanced-section device picker goes through here too now -- it used to
  // call link.connectBleToDevice() directly, which connects BLE for real
  // but never touches _state, so the session had no idea it happened: the
  // Connection row kept showing its old state, and Start Recording stayed
  // disabled (gated on state === "ble_ready") even once BLE was genuinely
  // connected. Any way BLE ends up connected needs to update state the
  // same way.
  async connectBleToDeviceManually(device: Device): Promise<void> {
    this.setState("connecting_ble");
    try {
      await this.link.connectBleToDevice(device);
      this.setState("ble_ready");
    } catch (err) {
      this.setState("ble_disconnected");
      throw err; // the debug screen's device picker shows this directly, unlike connectBleManually()
    }
  }

  async disconnectBleManually(): Promise<void> {
    this.emit("log", { line: "session: disconnecting BLE (manual)…" });
    await this.link.disconnectBle();
    this.emit("log", { line: `session: BLE disconnect done -- isBleConnected=${this.link.isBleConnected}` });
    this.setState("ble_disconnected");
  }

  // -- The actual recording flow: BLE-idle -> Wi-Fi -> episode -> BLE-idle --

  // Startup (hotspot -> BLE creds -> wait for hello -> video/sync/start) can
  // take many seconds, almost entirely waiting on waitForHello's up-to-25s
  // window. Without this, pressing Stop during that window hit
  // stopRecording()'s old `if (state !== "recording") return` guard and did
  // *nothing at all* -- no stop sent, no forget_wifi, nothing -- while the
  // original startRecording() kept running to completion in the background
  // regardless, which is exactly the "stop did nothing, frames kept
  // arriving, Start stayed disabled too" bug report. An abort signal lets
  // stopRecording() cut an in-flight startRecording() off immediately,
  // whatever step it's on, instead of requiring it to already be "recording".
  private pendingAbort: { aborted: boolean; promise: Promise<never>; abort: () => void } | null = null;

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
        reject(new Error("recording start was cancelled"));
      },
    };
    this.pendingAbort = signal;
    return signal;
  }

  private raceAbort<T>(promise: Promise<T>, signal: { promise: Promise<never> }): Promise<T> {
    return Promise.race([promise, signal.promise]);
  }

  async startRecording(episodeName: string): Promise<void> {
    if (this._state !== "ble_ready") {
      throw new Error(`Can't start recording from state "${this._state}" -- wait for "ble_ready" first.`);
    }
    const abort = this.beginAbortable();
    this.setState("starting_wifi");
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    try {
      const reservation = await this.raceAbort(this.link.startHotspot(), abort);
      this.hotspotGatewayIp = reservation.gatewayIp;
      // Android generates a new random SSID/password per hotspot start (no
      // public API lets a regular app fix it -- see hotspot.ts/
      // LocalHotspotModule.kt). Doesn't matter in practice: this always
      // resends whatever was just generated over BLE right here, so there's
      // no manual step either way. No app_ip: the phone is the gateway.
      await this.raceAbort(this.link.setWifiCredentials(reservation.ssid, reservation.password), abort);
      await this.raceAbort(this.waitForHello(WIFI_JOIN_TIMEOUT_MS), abort);
      // PROTOCOL_GLASSES.md documents a dedicated video command (on, every
      // Nth frame, JPEG quality 10-95) that we'd defined the type for but
      // never actually sent -- the board was just running whatever its own
      // default is the whole time.
      //
      // every:1, quality:90 (every frame, near-max quality) was the first
      // attempt, then every:2, quality:70 (the doc's own example values) --
      // both still showed real, measurable UDP packet loss in device logs
      // ("gap in JPEG fragments (expected byte X, got Y)": whole packets
      // genuinely going missing, not a parsing bug). This phone's software
      // hotspot carries the TCP command/data channels plus two simultaneous
      // RTP video streams at once; fewer, smaller packets per frame is the
      // direct lever to make that survive the trip more often. Dropping
      // quality further than the doc's own example, deliberately -- a
      // visibly-worse-but-present stream beats a correct-but-never-arriving
      // one.
      await this.raceAbort(this.link.sendCommand({ cmd: "video", on: true, every: 2, quality: 40 }), abort);
      // runTimeSync() itself now enforces EPISODES.md §3 step 2 (burst of
      // 30 pings, best RTT <= 20ms, retried up to 3 times) and returns null
      // if it never gets there -- refuse right here instead of sending
      // `start` on a sync the board is likely to reject anyway.
      if (!(await this.raceAbort(this.link.runTimeSync(), abort))) {
        throw new Error("clock sync too slow -- best round-trip time never got under 20ms after 3 tries (Wi-Fi is too congested for reliable timing right now)");
      }
      let ack = await this.raceAbort(this.link.sendCommand({ cmd: "start", episode: episodeName }), abort);
      if (ack && !ack.ok && ack.error === "sync_required") {
        // EPISODES.md §3's own error-table remedy for this exact rejection:
        // "sync again, then retry the start." Our own sync just passed the
        // stricter 20ms bar above, but the board's cutoff is time-based too
        // (no sync in the last 30s) and RTT can still drift past its 30ms
        // cutoff in the gap before `start` lands -- the video command just
        // before this is one extra round trip that gap has to survive.
        this.emit("log", { line: "session: start rejected (sync_required) -- re-syncing and retrying once" });
        if (!(await this.raceAbort(this.link.runTimeSync(), abort))) {
          throw new Error("clock sync too slow -- best round-trip time never got under 20ms after 3 tries (Wi-Fi is too congested for reliable timing right now)");
        }
        ack = await this.raceAbort(this.link.sendCommand({ cmd: "start", episode: episodeName }), abort);
      }
      if (!ack?.ok) {
        if (ack) {
          const a = ack as AckMessage;
          // slave_not_ready's whole point (EPISODES.md §3's error table) is
          // that `detail` says *why* -- cable vs. Wi-Fi vs. a 4s readiness
          // timeout -- which is exactly the information "start rejected:
          // slave_not_ready" alone was throwing away.
          throw new Error(`start rejected: ${a.error ?? "unknown reason"}${a.detail ? ` (${a.detail})` : ""}`);
        }
        throw new Error("start: no ack from the board");
      }
      this.currentEpisode = episodeName;
      this.setState("recording");
    } catch (err) {
      if (abort.aborted) {
        // stopRecording() triggered this and is already doing its own
        // stop/forget_wifi/teardown sequence -- don't race it with a
        // second one here. Still worth a best-effort stopHotspot() of our
        // own: startHotspot() itself is async (native-side), so it's
        // possible the hotspot only actually finishes starting *after*
        // the abort already fired -- without this it could end up running,
        // orphaned, with nothing left that still thinks it owns it.
        this.link.stopHotspot().catch(() => undefined);
        return;
      }
      this.emit("log", {
        line: `session: startRecording failed (${err instanceof Error ? err.message : String(err)}) -- stopping hotspot, back to BLE`,
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
    // Cuts an in-flight startRecording() off right now, whatever step it's
    // waiting on -- see beginAbortable()'s comment above for why this has
    // to exist at all.
    this.pendingAbort?.abort();

    this.setState("stopping");
    // Exactly two commands, nothing else in between -- stop the episode,
    // then (via returnToBleReady(), after a settling gap) forget_wifi so
    // the board switches back to BLE. There may genuinely be no command
    // connection yet if Wi-Fi never came up before Stop was pressed --
    // sendCommand() already handles that gracefully (logs it, resolves
    // null) instead of throwing.
    this.emit("log", { line: `session: stop(${episodeName})` });
    await this.link.sendCommand({ cmd: "stop", episode: episodeName }, 5000);
    await this.returnToBleReady();
  }

  // forget_wifi, not just dropping the hotspot: PROTOCOL_GLASSES.md's own
  // wording is "the ack comes first; ~0.5s later the Wi-Fi drops, this
  // connection closes, and Glasses-L advertises over BLE" -- i.e. a real,
  // bounded, acked handoff signal, instead of us silently killing the AP
  // and waiting an unspecified amount of time for the board to notice the
  // link is gone on its own and fall back. It's refused while "recording",
  // which is exactly why this only ever runs after stop/a failed start has
  // already taken the session out of that state.
  //
  // No credential downside from forgetting them: Android hands out a brand
  // new random SSID/password on every hotspot start regardless (see
  // startHotspot()'s own comment), so the next startRecording() was always
  // going to resend fresh ones over BLE either way.
  //
  // BLE is then explicitly re-checked and reconnected if needed, rather than
  // assuming it never dropped. The protocol doc says an already-connected
  // phone stays connected through the Wi-Fi switch, but that didn't hold up
  // on real hardware -- so this is a deliberate, visible reconnect, not a
  // passive wait for a disconnect event that may or may not fire.
  private async returnToBleReady(): Promise<void> {
    this.currentEpisode = null;
    this.hotspotGatewayIp = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);

    if (this.link.isConnected) {
      // A deliberate 1s gap after stop's ack, not sent back-to-back --
      // forget_wifi is refused while the board still considers itself
      // "recording", and an ack alone doesn't guarantee its internal state
      // has fully settled back to idle yet.
      await sleep(1000);
      this.emit("log", { line: "session: forget_wifi" });
      await this.link.sendCommand({ cmd: "forget_wifi" }, 3000);
    }
    await this.link.stopHotspot().catch(() => undefined);

    // One automatic BLE reconnect attempt here, and only here -- this is
    // NOT the auto-reconnect loop that was removed elsewhere in this file
    // (see the constructor's comment), and it doesn't carry the same risk:
    // that loop caused problems because it kept scanning/connecting WHILE
    // Wi-Fi was still active, competing with the hotspot for radio time.
    // By this point Wi-Fi is already fully torn down (stopHotspot() just
    // above), so there's nothing left for a BLE scan to compete with. One
    // attempt, not a retry loop -- if it fails, the user presses Connect
    // BLE manually, same as any other BLE connect failure.
    if (!this.link.isBleConnected) {
      this.setState("connecting_ble");
      try {
        await this.link.connectBle(10000);
      } catch (err) {
        this.emit("log", {
          line: `session: BLE reconnect after stop failed (${err instanceof Error ? err.message : String(err)}) -- press Connect BLE`,
        });
        this.setState("ble_disconnected");
        return;
      }
    }
    this.setState("ble_ready");
  }

  async runTimeSyncNow(): Promise<TimeSyncResult | null> {
    return this.link.runTimeSync();
  }

  sendCommand(command: GlassesCommand, timeoutMs?: number): Promise<AckMessage | null> {
    return this.link.sendCommand(command, timeoutMs);
  }

  private waitForHello(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error("timed out waiting for the board to join Wi-Fi and say hello"));
      }, timeoutMs);
      const unsub = this.link.on("hello", () => {
        clearTimeout(timer);
        unsub();
        resolve();
      });
    });
  }

  // Called on a graceful exit (navigating away, the screen unmounting,
  // backgrounding) -- NOT reachable during an actual process kill/crash,
  // since no JS runs at all at that point. For a real crash there is
  // nothing more to do here: Android tears down LocalOnlyHotspot
  // automatically the instant the owning app's process dies (by design --
  // it's explicitly tied to the requesting app, so apps can't keep a hidden
  // AP running in the background), so the board sees that as an ordinary
  // Wi-Fi drop and falls back to BLE advertising on its own, the same as
  // any other link loss it already has to handle.
  //
  // For the graceful case, this used to just drop the hotspot straight
  // away mid-episode with no warning -- functionally a network failure from
  // the board's point of view, same as a crash, even though we had a live
  // TCP connection the whole time and could have just said so. Now it sends
  // a real `stop` first and waits briefly for it, so the board can close
  // the episode out cleanly instead of discovering the link gone.
  destroy() {
    this.destroyed = true;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    // Same reasoning as stopRecording()'s abort -- without this, destroying
    // the session while still mid-handshake (e.g. the screen was closed
    // while waiting for hello) left the old startRecording() running
    // against a GlassesLink that's being torn down out from under it.
    this.pendingAbort?.abort();

    const wasActive = this._state === "recording" || this._state === "starting_wifi";
    if (wasActive && this.currentEpisode) {
      const episode = this.currentEpisode;
      this.emit("log", { line: `session: destroy() while active -- sending stop(${episode}) + forget_wifi before tearing down` });
      this.link
        .sendCommand({ cmd: "stop", episode }, 2000)
        .then(() => sleep(1000)) // same settling gap as returnToBleReady() -- forget_wifi right after stop's ack can still be refused as "recording"
        .then(() => this.link.sendCommand({ cmd: "forget_wifi" }, 2000))
        .catch(() => undefined)
        .finally(() => this.link.destroy());
      return;
    }
    this.link.destroy();
  }
}
