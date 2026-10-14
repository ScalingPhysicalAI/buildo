// Talks to the same deployed backend as apps/mobile (apps/portal). Only the
// App Store listing is real right now -- everything else in this app
// (auth, wallet, robot connection, voice) is dummy/local, so this file only
// needs the one public, unauthenticated endpoint that powers the Store tab.
const SERVER_URL = "https://portal.starforgerobotics.com";

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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function fetchAppStore(): Promise<StoreApp[]> {
  const res = await fetch(`${SERVER_URL}/api/public/app-store`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? "Couldn't load the app store", res.status);
  }
  return data.apps;
}
