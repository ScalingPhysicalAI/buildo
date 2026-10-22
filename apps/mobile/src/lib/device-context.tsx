// Pairing/connection state for the capture glasses and haptic gloves.
//
// Glasses are real now: backed by one app-wide GlassesSession (same class
// the Debug screen uses, unmodified), created once here and shared via
// context so both the Gadgets/pair screen and a skill's recording screen
// talk to the exact same live connection -- BLE connected on the Gadgets
// tab stays connected when you navigate to Skills, exactly like the Debug
// screen's own flow. `glasses`/`glasses_battery` are real, mapped from the
// session's own state/status; `connectGlasses`/`disconnect("glasses")` are
// thin wrappers around the session's existing connect/disconnect methods.
// `glassesSession` is also exposed directly so a recording screen can call
// startRecording()/stopRecording() and listen to hello/status/peer/frame
// the same way the Debug screen does.
//
// Gloves have no real hardware/implementation yet -- unchanged, still a
// timed simulation.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { GlassesSession, type SessionState } from "./glasses/glasses-session";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Collapses GlassesSession's more detailed state machine down to the
// simple 3-value status the rest of the app already understands. Deliberate
// choice: "starting_wifi" / "recording" / "stopping" all map to "connected"
// here, not just "ble_ready" -- from this screen's point of view the glasses
// are still "connected to the app" throughout the whole Wi-Fi handoff, even
// though the radio hops between BLE and Wi-Fi underneath. That's exactly
// what keeps a skill's recording screen from showing a spurious "glasses
// disconnected" the instant a recording starts.
function toConnectionStatus(state: SessionState): ConnectionStatus {
  switch (state) {
    case "connecting_ble":
      return "connecting";
    case "ble_ready":
    case "starting_wifi":
    case "recording":
    case "stopping":
      return "connected";
    case "idle":
    case "ble_disconnected":
    default:
      return "disconnected";
  }
}

interface DeviceState {
  glasses: ConnectionStatus;
  glasses_battery: number | null;
  // Set when the last connect attempt failed, cleared on the next attempt
  // or once connected -- lets the Gadgets screen show *why* it's still
  // disconnected instead of just silently sitting there.
  glasses_error: string | null;
  gloves: ConnectionStatus;
  gloves_battery: number | null;
  connectGlasses: () => void;
  connectGloves: () => void;
  disconnect: (device: "glasses" | "gloves") => void;
  glassesSession: GlassesSession;
}

const DeviceContext = createContext<DeviceState | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  // Lazy useState initializer, not a ref mutated during render -- this is
  // the one the Rules of Hooks actually sanctions for "create exactly once."
  const [glassesSession] = useState(() => new GlassesSession());

  const [glasses, setGlasses] = useState<ConnectionStatus>("disconnected");
  const [glassesBattery, setGlassesBattery] = useState<number | null>(null);
  const [glassesError, setGlassesError] = useState<string | null>(null);

  useEffect(() => {
    // Starts the TCP listeners only -- no auto BLE connect, same as the
    // Debug screen (see glasses-session.ts's own constructor comment for
    // why that's deliberate). The app-wide session persists for the whole
    // app lifetime; this effect's cleanup only runs if DeviceProvider
    // itself unmounts, which in practice means the app is closing.
    const session = glassesSession;
    session.start();

    const unsubState = session.on("state", ({ state }) => {
      setGlasses(toConnectionStatus(state));
      if (state === "ble_ready") setGlassesError(null);
    });
    const unsubStatus = session.link.on("status", (status) => {
      setGlassesBattery(status.battery.left?.pct ?? null);
    });
    const unsubConnectError = session.on("bleConnectError", ({ notFound }) => {
      setGlassesError(
        notFound
          ? "Glasses not found -- check they're within Bluetooth range and powered on, then try again."
          : "Couldn't connect to the glasses. Try again."
      );
    });

    return () => {
      unsubState();
      unsubStatus();
      unsubConnectError();
      session.destroy();
    };
  }, [glassesSession]);

  const [gloves, setGloves] = useState<ConnectionStatus>("disconnected");
  const [glovesBattery, setGlovesBattery] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function after(ms: number, fn: () => void) {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }

  function connectGlasses() {
    setGlassesError(null);
    glassesSession.connectBleManually().catch(() => undefined);
  }

  function connectGloves() {
    setGloves("connecting");
    after(1900, () => {
      setGloves("connected");
      setGlovesBattery(64);
    });
  }

  function disconnect(device: "glasses" | "gloves") {
    if (device === "glasses") {
      glassesSession.disconnectBleManually().catch(() => undefined);
    }
    if (device === "gloves") {
      setGloves("disconnected");
      setGlovesBattery(null);
    }
  }

  return (
    <DeviceContext.Provider
      value={{
        glasses,
        glasses_battery: glassesBattery,
        glasses_error: glassesError,
        gloves,
        gloves_battery: glovesBattery,
        connectGlasses,
        connectGloves,
        disconnect,
        glassesSession,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevices(): DeviceState {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDevices must be used within DeviceProvider");
  return ctx;
}
