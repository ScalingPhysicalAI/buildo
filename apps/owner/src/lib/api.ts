// Talks to the same deployed backend as apps/mobile (apps/portal) -- same
// accounts, same database. The portal's cookie-based web sessions don't
// work for a mobile client, so this uses the bearer-token path that already
// exists there (apps/portal/src/lib/auth.ts: getUserFromRequest reads
// Authorization: Bearer before falling back to the cookie), same as
// apps/mobile does. Robot owners sign up with role "OWNER" -- the backend
// previously only had DEVELOPER/RESEARCHER (creator-side); OWNER was added
// alongside this app's real auth.
import AsyncStorage from "@react-native-async-storage/async-storage";

const SERVER_URL = "https://portal.starforgerobotics.com";

const TOKEN_KEY = "buildo-owner.token";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  walletAddress: string | null;
  tokenBalance: number;
  emailVerified: boolean;
  referralCode: string | null;
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

export async function signup(name: string, email: string, password: string): Promise<SafeUser> {
  const data = await request<{ user: SafeUser; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password, role: "OWNER" }),
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

export async function topUpWallet(amountUsd: number): Promise<SafeUser> {
  const data = await request<{ user: SafeUser }>("/api/wallet/topup", {
    method: "POST",
    body: JSON.stringify({ amountUsd }),
  });
  return data.user;
}

export type AppCategory = "HOME" | "SHOP" | "OFFICE" | "WAREHOUSE" | "HOSPITAL";

export interface StoreApp {
  id: string;
  name: string;
  description: string | null;
  category: AppCategory;
  iconUrl: string | null;
  installCount: number;
  creatorName: string;
  publishedAt: string | null;
}

export async function fetchAppStore(): Promise<StoreApp[]> {
  const res = await fetch(`${SERVER_URL}/api/public/app-store`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? "Couldn't load the app store", res.status);
  }
  return data.apps;
}
