import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { skillCollectionCreateSchema } from "@/lib/validations";
import { resolveCollectionStatuses } from "@/lib/skill-collection";

export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const collections = await prisma.skillCollectionSession.findMany({
    where: { userId },
    include: { skill: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ collections: await resolveCollectionStatuses(collections) });
}

// Called once the mobile app has finished uploading a recorded session for a
// skill. Pays the skill's reward immediately (no review step -- same
// "instant, not gated" policy as the signup bonus) and creates the
// UPLOADED-status session the Train button acts on next.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = skillCollectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const skill = await prisma.skillDefinition.findUnique({
    where: { slug: parsed.data.skillSlug },
  });
  if (!skill || !skill.active) {
    return NextResponse.json({ error: "Unknown skill" }, { status: 400 });
  }

  // Custom (isCustom) skills always have reward 0 -- skip the credit and
  // the ledger entry entirely rather than recording a $0 "reward".
  const [updatedUser, collection] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: skill.reward > 0 ? { tokenBalance: { increment: skill.reward } } : {},
    }),
    prisma.skillCollectionSession.create({
      data: {
        userId,
        skillId: skill.id,
        status: "UPLOADED",
        fileName: parsed.data.fileName,
        durationSec: parsed.data.durationSec,
        rewardPaid: skill.reward > 0,
      },
      include: { skill: true },
    }),
  ]);

  if (skill.reward > 0) {
    await prisma.tokenTransaction.create({
      data: {
        userId,
        type: "SKILL_COLLECTION_REWARD",
        amount: skill.reward,
        note: `Recorded: ${skill.name}`,
      },
    });
  }

  return NextResponse.json({ user: toSafeUser(updatedUser), collection }, { status: 201 });
}
