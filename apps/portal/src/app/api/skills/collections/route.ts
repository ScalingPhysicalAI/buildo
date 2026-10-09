import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
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

// A paid skill's recording must run at least this long before it can be
// uploaded -- mirrors the client-side gate on the Stop button, enforced
// again here since the client can't be trusted. Custom (unpaid) skills have
// no minimum.
const MIN_PAID_RECORDING_SEC = 120;

// Called once the mobile app has finished uploading a recorded session for a
// skill. Does NOT pay anything at upload time -- a skill's reward is only
// ever realized later, per install, once it's part of a published app
// someone else installs (see POST /api/apps/:id/install). This just creates
// the UPLOADED-status session the Train button acts on next.
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

  if (skill.reward > 0 && (parsed.data.durationSec ?? 0) < MIN_PAID_RECORDING_SEC) {
    return NextResponse.json(
      { error: `Recording must be at least ${MIN_PAID_RECORDING_SEC / 60} minutes long for a paid skill` },
      { status: 400 }
    );
  }

  const collection = await prisma.skillCollectionSession.create({
    data: {
      userId,
      skillId: skill.id,
      status: "UPLOADED",
      fileName: parsed.data.fileName,
      durationSec: parsed.data.durationSec,
    },
    include: { skill: true },
  });

  return NextResponse.json({ collection }, { status: 201 });
}
