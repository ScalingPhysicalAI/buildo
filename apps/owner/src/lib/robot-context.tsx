// Everything here is a local, dummy simulation -- there's no real robot
// pairing, SIM/WiFi provisioning, payment processor, or voice pipeline wired
// up yet. State is persisted to AsyncStorage so it survives app restarts and
// feels real to use, but every "connect"/"top up"/"install" action below is
// just a timed local-state change. Swap each one for a real API call once
// the corresponding backend/hardware piece exists.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STATE_KEY = "buildo-owner.robot-state";

export type ConnectionMethod = "wifi" | "sim";

export interface VoiceLogEntry {
  id: string;
  text: string;
  at: string;
}

export interface InstalledApp {
  id: string;
  name: string;
  installedAt: string;
}

interface RobotState {
  connected: boolean;
  connectionMethod: ConnectionMethod | null;
  robotName: string;
  walletBalance: number;
  voiceLog: VoiceLogEntry[];
  installedApps: InstalledApp[];
}

const DEFAULT_STATE: RobotState = {
  connected: false,
  connectionMethod: null,
  robotName: "My Buildo",
  walletBalance: 0,
  voiceLog: [],
  installedApps: [],
};

interface RobotContextValue extends RobotState {
  isLoading: boolean;
  connectRobot: (method: ConnectionMethod) => Promise<void>;
  disconnectRobot: () => Promise<void>;
  topUp: (amount: number) => Promise<void>;
  sendVoiceCommand: (text: string) => Promise<void>;
  installApp: (id: string, name: string) => Promise<void>;
}

const RobotContext = createContext<RobotContextValue | null>(null);

export function RobotProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RobotState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STATE_KEY)
      .then((raw) => setState(raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE))
      .finally(() => setIsLoading(false));
  }, []);

  async function persist(next: RobotState) {
    setState(next);
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(next));
  }

  async function connectRobot(method: ConnectionMethod) {
    await new Promise((r) => setTimeout(r, 1400));
    await persist({ ...state, connected: true, connectionMethod: method });
  }

  async function disconnectRobot() {
    await persist({ ...state, connected: false, connectionMethod: null });
  }

  async function topUp(amount: number) {
    await new Promise((r) => setTimeout(r, 700));
    await persist({ ...state, walletBalance: state.walletBalance + amount });
  }

  async function sendVoiceCommand(text: string) {
    const entry: VoiceLogEntry = { id: String(Date.now()), text, at: new Date().toISOString() };
    await persist({ ...state, voiceLog: [entry, ...state.voiceLog].slice(0, 20) });
  }

  async function installApp(id: string, name: string) {
    if (state.installedApps.some((a) => a.id === id)) return;
    const entry: InstalledApp = { id, name, installedAt: new Date().toISOString() };
    await persist({ ...state, installedApps: [entry, ...state.installedApps] });
  }

  return (
    <RobotContext.Provider
      value={{ ...state, isLoading, connectRobot, disconnectRobot, topUp, sendVoiceCommand, installApp }}
    >
      {children}
    </RobotContext.Provider>
  );
}

export function useRobot(): RobotContextValue {
  const ctx = useContext(RobotContext);
  if (!ctx) throw new Error("useRobot must be used within RobotProvider");
  return ctx;
}
