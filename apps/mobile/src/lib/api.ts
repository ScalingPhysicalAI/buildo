// Talks to the exact same backend as apps/portal -- same accounts, same
// database. The portal's cookie-based web sessions don't work for a mobile
// client, so this uses the bearer-token path that already exists there
// (apps/portal/src/lib/auth.ts: getUserFromRequest reads Authorization:
// Bearer before falling back to the cookie) -- added specifically for this
// app, not something new being invented here.

import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "buildo.token";

// Always the real deployed portal -- no local/LAN override in the UI
// (there was one; removed on request, this app should just point at
// production). If local-server testing is needed again later, that's a
// dev-time env swap here, not a user-facing setting.
const SERVER_URL = "https://portal.starforgerobotics.com";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export type Role = "DEVELOPER" | "RESEARCHER";

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  walletAddress: string | null;
  tokenBalance: number;
  emailVerified: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();

  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<SafeUser> {
  const data = await request<{ user: SafeUser; token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setToken(data.token);
  return data.user;
}

export async function signup(name: string, email: string, password: string, role: Role): Promise<SafeUser> {
  const data = await request<{ user: SafeUser; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password, role }),
  });
  await setToken(data.token);
  return data.user;
}

export async function fetchMe(): Promise<SafeUser | null> {
  const data = await request<{ user: SafeUser | null }>("/api/auth/me");
  return data.user;
}

export async function logout(): Promise<void> {
  await clearToken();
}
