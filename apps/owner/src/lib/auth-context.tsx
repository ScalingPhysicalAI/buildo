// Dummy auth for now -- no backend account exists yet for robot owners (the
// portal only has DEVELOPER/RESEARCHER accounts, both creator-side). This
// just persists a local fake profile so the rest of the app has a `user` to
// read, and the login/signup screens feel real to use. Swap in a real
// owner-account API once one exists on the backend.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const USER_KEY = "buildo-owner.user";

export interface DummyUser {
  name: string;
  email: string;
}

interface AuthState {
  user: DummyUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DummyUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(USER_KEY)
      .then((raw) => setUser(raw ? JSON.parse(raw) : null))
      .finally(() => setIsLoading(false));
  }, []);

  async function persist(next: DummyUser) {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(next));
    setUser(next);
  }

  async function login(email: string, _password: string) {
    await new Promise((r) => setTimeout(r, 500));
    await persist({ name: email.split("@")[0] || "Robot Owner", email });
  }

  async function signup(name: string, email: string, _password: string) {
    await new Promise((r) => setTimeout(r, 500));
    await persist({ name, email });
  }

  async function logout() {
    await AsyncStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
