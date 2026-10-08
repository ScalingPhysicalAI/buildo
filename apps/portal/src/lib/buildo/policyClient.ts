// Queries services/policy-server for a BuildoActionChunk, buffers its
// actions[] locally, and hands them out one per tick() call -- so the
// caller's physics loop keeps running smoothly between requests instead of
// blocking on the network every step (per the doc's own §5 diagram, and
// this repo's phased plan's Phase 4 description).
//
// SAFE HOLD: if the buffer runs dry and no new chunk has arrived (server
// down, slow, or the request itself failed/timed out), tick() returns null
// instead of extrapolating a guess. The caller's job is simple: when tick()
// returns null, don't call applyAction() that step. Since applyAction
// writes absolute actuator targets (data.ctrl), simply not calling it again
// leaves the base/arm/grip targets exactly where they last were -- base
// stops, arm holds its last commanded pose, grip stays shut or open as it
// was. That's the doc's "stop base, hold arm target, maintain grip" SAFE
// HOLD behavior, achieved by construction rather than as a separate branch
// that has to remember to zero things out.

import { deserializeActionChunk, serializeObservation, type ActionEntry, type BuildoActionChunk, type BuildoObservation } from "@buildo/schema";

export type PolicyClientStatus = "connecting" | "ok" | "safe-hold";
export type SafeHoldReason = "timeout" | "network-error" | "bad-response" | null;

export interface PolicyClientState {
  status: PolicyClientStatus;
  reason: SafeHoldReason;
  lastChunkAtMs: number | null;
  lastError: string | null;
}

const REQUEST_TIMEOUT_MS = 1500;
const MIN_RETRY_INTERVAL_MS = 300; // don't hammer a down/slow server every tick
const REQUEST_WHEN_ENTRIES_LEFT = 3; // start fetching the next chunk before this one runs out

export class PolicyClient {
  private readonly url: string;
  private chunk: BuildoActionChunk | null = null;
  private entryIndex = 0;
  private requestInFlight = false;
  private lastRequestAttemptMs = 0;
  private state: PolicyClientState = { status: "connecting", reason: null, lastChunkAtMs: null, lastError: null };

  constructor(url: string) {
    this.url = url;
  }

  getState(): PolicyClientState {
    return this.state;
  }

  /** Call once per physics tick. Returns the action to apply this tick, or
   * null when in SAFE HOLD -- see this file's own header comment. */
  tick(nowMs: number, buildObservation: () => BuildoObservation): ActionEntry | null {
    const bufferedLeft = this.chunk ? this.chunk.actions.length - this.entryIndex : 0;

    if (!this.requestInFlight && bufferedLeft <= REQUEST_WHEN_ENTRIES_LEFT && nowMs - this.lastRequestAttemptMs > MIN_RETRY_INTERVAL_MS) {
      try {
        this.requestChunk(buildObservation());
      } catch (err) {
        // A bad observation shouldn't take down the render loop -- log and
        // fall through to the normal SAFE HOLD path below.
        // eslint-disable-next-line no-console
        console.error("[PolicyClient] failed to build observation:", err);
      }
    }

    if (this.chunk && this.entryIndex < this.chunk.actions.length) {
      const entry = this.chunk.actions[this.entryIndex];
      this.entryIndex += 1;
      return entry;
    }

    if (this.state.status !== "safe-hold") {
      this.state = { ...this.state, status: "safe-hold", reason: this.state.reason ?? "timeout" };
    }
    return null;
  }

  private async requestChunk(obs: BuildoObservation): Promise<void> {
    this.requestInFlight = true;
    this.lastRequestAttemptMs = performance.now();
    try {
      const body = serializeObservation(obs);
      const res = await fetch(this.url, {
        method: "POST",
        body: body as BodyInit,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`policy server responded ${res.status}`);
      const text = await res.text();
      const chunk = deserializeActionChunk(text);
      this.chunk = chunk;
      this.entryIndex = 0;
      const now = performance.now();
      this.state = { status: "ok", reason: null, lastChunkAtMs: now, lastError: null };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[PolicyClient] request to policy server failed:", err);
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      this.state = {
        status: "safe-hold",
        reason: isTimeout ? "timeout" : "network-error",
        lastChunkAtMs: this.state.lastChunkAtMs,
        lastError: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.requestInFlight = false;
    }
  }
}
