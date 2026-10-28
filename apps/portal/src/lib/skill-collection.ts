import type { SkillCollectionSession } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// TEMP: shortened from the real 24h to 1 min so the Train -> Build flow can
// be tested end to end without waiting a day. Restore to 24 * 60 * 60 * 1000
// before this is real.
export const TRAIN_DURATION_MS = 1 * 60 * 1000;

/**
 * The 24h "Train" timer is modeled as `trainEndsAt` rather than a background
 * job -- a session sitting in TRAINING with an expired `trainEndsAt` is
 * resolved to TRAINED (persisted) the next time anything reads it, so no
 * scheduler is needed for this to work correctly.
 */
export async function resolveCollectionStatus(
  session: SkillCollectionSession
): Promise<SkillCollectionSession> {
  if (session.status !== "TRAINING" || !session.trainEndsAt) return session;
  if (session.trainEndsAt > new Date()) return session;

  return prisma.skillCollectionSession.update({
    where: { id: session.id },
    data: { status: "TRAINED" },
  });
}

export async function resolveCollectionStatuses(
  sessions: SkillCollectionSession[]
): Promise<SkillCollectionSession[]> {
  return Promise.all(sessions.map(resolveCollectionStatus));
}
