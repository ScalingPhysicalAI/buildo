import type { AppListing } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// TEMP: shortened from the real 7 days so the Train and Deploy -> Live flow
// can be tested end to end without waiting a week. Restore to
// 7 * 24 * 60 * 60 * 1000 before this is real.
export const APP_TESTING_DURATION_MS = 1 * 60 * 1000;

export const APP_DEPLOY_FEE = 5;

/**
 * The 7-day testing window is modeled as `testingEndsAt` rather than a
 * background job -- an app sitting in TESTING with an expired
 * `testingEndsAt` is resolved to LIVE (and charged the one-time deploy fee)
 * the next time anything reads it, same pattern as
 * skill-collection.ts#resolveCollectionStatus. If the fee can't be charged
 * (e.g. insufficient balance), the app stays in TESTING and is retried the
 * next time it's read.
 */
export async function resolveAppStatus<T extends AppListing>(app: T): Promise<T> {
  if (app.status !== "TESTING" || !app.testingEndsAt) return app;
  if (app.testingEndsAt > new Date()) return app;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: app.userId } });
      if (!user || user.tokenBalance < APP_DEPLOY_FEE) {
        throw new Error("CANNOT_CHARGE");
      }

      await tx.user.update({
        where: { id: app.userId },
        data: { tokenBalance: { decrement: APP_DEPLOY_FEE } },
      });

      await tx.tokenTransaction.create({
        data: {
          userId: app.userId,
          type: "APP_DEPLOY_FEE",
          amount: -APP_DEPLOY_FEE,
          note: `Deploy fee: ${app.name}`,
        },
      });

      return tx.appListing.update({
        where: { id: app.id },
        data: { status: "LIVE", publishedAt: new Date() },
      });
    });
    return { ...app, ...updated };
  } catch {
    return app;
  }
}

export async function resolveAppStatuses<T extends AppListing>(apps: T[]): Promise<T[]> {
  return Promise.all(apps.map(resolveAppStatus));
}
