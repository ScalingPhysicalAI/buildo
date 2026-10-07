// Local, in-memory session list for this app run -- not persisted to disk
// or uploaded anywhere yet. That's real, separate future work (the PDF's
// capture-session storage: video + glove sensor data landing on the server
// under the user's account). This gets the recording -> review -> upload
// flow right first, with an upload() that's a timed stand-in for the real
// network call, same pattern as device pairing in device-context.tsx.

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type SessionStatus = "idle" | "uploading" | "uploaded";

export interface Session {
  id: string;
  skillName: string;
  durationSeconds: number;
  createdAt: number;
  status: SessionStatus;
}

interface SessionsState {
  sessions: Session[];
  addSession: (skillName: string, durationSeconds: number) => void;
  deleteSession: (id: string) => void;
  uploadSession: (id: string) => void;
  getSession: (id: string) => Session | undefined;
}

const SessionsContext = createContext<SessionsState | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function addSession(skillName: string, durationSeconds: number) {
    const session: Session = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e4)}`,
      skillName,
      durationSeconds,
      createdAt: Date.now(),
      status: "idle",
    };
    setSessions((prev) => [session, ...prev]);
  }

  function deleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function uploadSession(id: string) {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "uploading" } : s)));
    const t = setTimeout(() => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "uploaded" } : s)));
    }, 1800);
    timers.current.push(t);
  }

  function getSession(id: string) {
    return sessions.find((s) => s.id === id);
  }

  return (
    <SessionsContext.Provider value={{ sessions, addSession, deleteSession, uploadSession, getSession }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsState {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within SessionsProvider");
  return ctx;
}
