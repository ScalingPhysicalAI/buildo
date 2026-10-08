import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { TRAIN_DURATION_MS } from "@/lib/skill-collection";

// Starts the 24h training timer for one uploaded recording. Only valid from
// UPLOADED -- greyed out in the UI otherwise, enforced again here since the
// client can't be trusted.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.skillCollectionSession.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status !== "UPLOADED") {
    return NextResponse.json({ error: "This recording isn't ready to train" }, { status: 409 });
  }

  const trainStartedAt = new Date();
  const trainEndsAt = new Date(trainStartedAt.getTime() + TRAIN_DURATION_MS);

  const collection = await prisma.skillCollectionSession.update({
    where: { id },
    data: { status: "TRAINING", trainStartedAt, trainEndsAt },
    include: { skill: true },
  });

  return NextResponse.json({ collection });
}
