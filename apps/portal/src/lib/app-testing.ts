import type { AppListing } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// TEMP: shortened from the real 7 days so the Train and Deploy -> Live flow
// can be tested end to end without waiting a week. Restore to
// 7 * 24 * 60 * 60 * 1000 before this is real.
export const APP_TESTING_DURATION_MS = 1 * 60 * 1000;

// Charged up front when "Train and Deploy" starts the testing window (see
// apps/[id]/deploy/route.ts) -- not charged again here.
export const APP_DEPLOY_FEE = 5;

/**
 * The 7-day testing window is modeled as `testingEndsAt` rather than a
 * background job -- an app sitting in TESTING with an expired
 * `testingEndsAt` is resolved to LIVE the next time anything reads it, same
 * pattern as skill-collection.ts#resolveCollectionStatus.
 */
export async function resolveAppStatus<T extends AppListing>(app: T): Promise<T> {
  if (app.status !== "TESTING" || !app.testingEndsAt) return app;
  if (app.testingEndsAt > new Date()) return app;

  const updated = await prisma.appListing.update({
    where: { id: app.id },
    data: { status: "LIVE", publishedAt: new Date() },
  });
  return { ...app, ...updated };
}

export async function resolveAppStatuses<T extends AppListing>(apps: T[]): Promise<T[]> {
  return Promise.all(apps.map(resolveAppStatus));
}
