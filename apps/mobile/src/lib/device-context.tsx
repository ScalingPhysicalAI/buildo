// Pairing/connection state for glasses, gloves, and the Buildo unit's wifi.
// No real hardware exists yet (same situation as the rest of this repo --
// see the browser simulator's own "no paired robot hardware" notes) so
// "connecting" here is a timed simulation, not a real BLE/wifi handshake.
// The UI/state shape is real and meant to stay -- only the two connect__
// functions' bodies get replaced once real pairing exists.

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

interface DeviceState {
  glasses: ConnectionStatus;
  glasses_battery: number | null;
  gloves: ConnectionStatus;
  gloves_battery: number | null;
  buildo: ConnectionStatus;
  buildoNetwork: string | null;
  connectGlasses: () => void;
  connectGloves: () => void;
  connectBuildo: (ssid: string) => void;
  disconnect: (device: "glasses" | "gloves" | "buildo") => void;
}

const DeviceContext = createContext<DeviceState | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [glasses, setGlasses] = useState<ConnectionStatus>("disconnected");
  const [glassesBattery, setGlassesBattery] = useState<number | null>(null);
  const [gloves, setGloves] = useState<ConnectionStatus>("disconnected");
  const [glovesBattery, setGlovesBattery] = useState<number | null>(null);
  const [buildo, setBuildo] = useState<ConnectionStatus>("disconnected");
  const [buildoNetwork, setBuildoNetwork] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function after(ms: number, fn: () => void) {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }

  function connectGlasses() {
    setGlasses("connecting");
    after(1600, () => {
      setGlasses("connected");
      setGlassesBattery(78);
    });
  }

  function connectGloves() {
    setGloves("connecting");
    after(1900, () => {
      setGloves("connected");
      setGlovesBattery(64);
    });
  }

  function connectBuildo(ssid: string) {
    setBuildo("connecting");
    setBuildoNetwork(ssid);
    after(2200, () => setBuildo("connected"));
  }

  function disconnect(device: "glasses" | "gloves" | "buildo") {
    if (device === "glasses") {
      setGlasses("disconnected");
      setGlassesBattery(null);
    }
    if (device === "gloves") {
      setGloves("disconnected");
      setGlovesBattery(null);
    }
    if (device === "buildo") {
      setBuildo("disconnected");
      setBuildoNetwork(null);
    }
  }

  return (
    <DeviceContext.Provider
      value={{
        glasses,
        glasses_battery: glassesBattery,
        gloves,
        gloves_battery: glovesBattery,
        buildo,
        buildoNetwork,
        connectGlasses,
        connectGloves,
        connectBuildo,
        disconnect,
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
