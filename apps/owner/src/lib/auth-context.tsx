// Real account, same backend/database as apps/mobile -- robot owners sign
// up with role "OWNER" (see lib/api.ts). Session is a bearer token in
// AsyncStorage, restored on launch via /api/auth/me, same pattern as
// apps/mobile's auth-context.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import {
  fetchMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  topUpWallet,
  type SafeUser,
} from "./api";

interface AuthState {
  user: SafeUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  topUp: (amountUsd: number) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function refresh() {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const loggedInUser = await apiLogin(email, password);
    setUser(loggedInUser);
  }

  async function signup(name: string, email: string, password: string) {
    const newUser = await apiSignup(name, email, password);
    setUser(newUser);
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  async function topUp(amountUsd: number) {
    const updated = await topUpWallet(amountUsd);
    setUser(updated);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout, refresh, topUp }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
