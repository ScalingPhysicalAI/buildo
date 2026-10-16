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
  // The creator/developer $ balance (apps/mobile, portal). Not shown or used
  // anywhere in this app -- see ownerWalletBalance below.
  tokenBalance: number;
  // The robot owner's own wallet, completely separate from tokenBalance even
  // though it's the same account/login. Starts at $0, only ever changes via
  // this app's top-up.
  ownerWalletBalance: number;
  emailVerified: boolean;
  referralCode: string | null;
  // Set once at signup if a valid referral code was entered -- never
  // changes after. Drives the rent discount (see rentTermMonths below).
  referredById: string | null;
  // The active rental plan, set via chooseRentPlan(). monthlyRentUsd is
  // locked in at the moment the plan was confirmed, from referredById's
  // discount rule at that time -- not recomputed later.
  rentTermMonths: number | null;
  monthlyRentUsd: number | null;
  rentStartedAt: string | null;
  // The real gate for store/skill access -- see isRentActive() below.
  // Compared against the current time, not flipped by any background job.
  rentPaidUntil: string | null;
}

// True once a plan exists and this month (or more) is paid for. The store
// and any installed skills are only usable while this is true -- compulsory,
// per the rent model (apps/portal's /api/robot-rental[/pay] are the only
// things that can make this true).
export function isRentActive(user: SafeUser | null): boolean {
  return !!user?.rentPaidUntil && new Date(user.rentPaidUntil).getTime() > Date.now();
}

// Shared threshold for "renews soon" banners (Home, Store) -- both rent and
// skill subscriptions warn inside this window rather than only after they've
// already lapsed.
export const EXPIRY_WARNING_DAYS = 5;

// Whole days until `dateStr`, rounded up (so "expires in a few hours" still
// reads as 1 day, not 0). null if there's no date to compare.
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

export type RentTermMonths = 3 | 6 | 12;

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

export async function signup(
  name: string,
  email: string,
  password: string,
  referralCode?: string
): Promise<SafeUser> {
  const data = await request<{ user: SafeUser; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ name, email, password, role: "OWNER", referralCode: referralCode || undefined }),
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

// Starts (or switches) the rental plan: locks in the monthly rate (referral
// discount applied if referredById was set at signup) and debits the FULL
// term upfront -- monthlyRentUsd * termMonths, e.g. 3mo @ $600/mo = $1800 --
// in exchange for termMonths * 30 days of rentPaidUntil. Throws (via
// ApiError) if the balance can't cover it.
export async function chooseRentPlan(termMonths: RentTermMonths): Promise<SafeUser> {
  const data = await request<{ user: SafeUser }>("/api/robot-rental", {
    method: "POST",
    body: JSON.stringify({ termMonths }),
  });
  return data.user;
}

// Renews the existing plan for one more full term at its already-locked
// rate -- same upfront, whole-term charge as chooseRentPlan, just without
// changing term or price.
export async function payRent(): Promise<SafeUser> {
  const data = await request<{ user: SafeUser }>("/api/robot-rental/pay", { method: "POST" });
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
  // Live count of currently-paid subscribers across all robot owners
  // (SkillSubscription.subscribedUntil > now) -- what the Store shows as
  // "Subscribed". Not cumulative: it drops the moment a subscription lapses
  // and isn't renewed, same number the app's creator sees on their own
  // build detail page in apps/mobile.
  subscriberCount: number;
  creatorName: string;
  publishedAt: string | null;
  monthlyPriceUsd: number;
  // The caller's own subscription expiry for this app, if any -- see
  // isSkillSubscriptionActive() below. null when logged out or never
  // subscribed.
  mySubscribedUntil: string | null;
}

// True once this skill has a paid, not-yet-expired subscription. Gates
// whether an installed skill can actually run on the robot (see
// store/[id].tsx) the same way isRentActive() gates the whole store.
export function isSkillSubscriptionActive(app: Pick<StoreApp, "mySubscribedUntil"> | null | undefined): boolean {
  return !!app?.mySubscribedUntil && new Date(app.mySubscribedUntil).getTime() > Date.now();
}

// Public endpoint, but sends the bearer token when logged in (via
// request<T>) so the response can include mySubscribedUntil per app.
export async function fetchAppStore(): Promise<StoreApp[]> {
  const data = await request<{ apps: StoreApp[] }>("/api/public/app-store");
  return data.apps;
}

// Pays for `months` of access to this skill (default 1), debited from
// ownerWalletBalance at the app's current monthlyPriceUsd. The backend
// rejects this with a 403 if robot rent isn't currently paid. Extends from
// the existing subscription if it hasn't expired yet, same renewal rule as
// robot rent.
export async function subscribeToSkill(
  appId: string,
  months = 1
): Promise<{ user: SafeUser; subscribedUntil: string; monthlyPriceUsd: number }> {
  return request(`/api/apps/${appId}/subscribe`, {
    method: "POST",
    body: JSON.stringify({ months }),
  });
}
