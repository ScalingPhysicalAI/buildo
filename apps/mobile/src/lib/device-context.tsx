// Pairing/connection state for the capture glasses and haptic gloves. The
// one app-wide GlassesSession lives here, shared via context so every
// screen talks to the exact same live connection. Gloves have no real
// hardware yet -- still a timed simulation.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { GlassesSession, type SessionState } from "./glasses/glasses-session";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Collapses GlassesSession's state machine to the 3-value status the rest
// of the app understands -- "starting_wifi"/"recording"/"stopping" all
// still read as "connected", not just "ble_ready".
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
  const [glassesSession] = useState(() => new GlassesSession());

  const [glasses, setGlasses] = useState<ConnectionStatus>("disconnected");
  const [glassesBattery, setGlassesBattery] = useState<number | null>(null);
  const [glassesError, setGlassesError] = useState<string | null>(null);

  useEffect(() => {
    // Starts the TCP listeners only -- no auto BLE connect.
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
