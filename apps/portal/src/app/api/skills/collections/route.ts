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
// TEMP: shortened from the real 2 minutes for testing. Restore to 120 before
// this is real.
const MIN_PAID_RECORDING_SEC = 10;

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

  // findFirst + insensitive, not findUnique -- the Debug screen's slug is a
  // free-text field (no catalog picker there), so a stray case mismatch
  // (e.g. "Wash-Dish" vs the real "wash-dish") must still resolve instead of
  // bouncing as "Unknown skill".
  let skill = await prisma.skillDefinition.findFirst({
    where: { slug: { equals: parsed.data.skillSlug, mode: "insensitive" } },
  });

  if ((!skill || !skill.active) && parsed.data.debug) {
    // Debug screen is testing the capture/upload pipeline itself, not
    // recording a real catalog skill -- an unused slug here shouldn't block
    // the upload, it should just become a throwaway custom skill (same
    // shape POST /api/skills/custom creates). Idempotent: a second debug
    // upload with the same slug finds this one via the lookup above instead
    // of hitting the unique constraint.
    try {
      skill = await prisma.skillDefinition.create({
        data: {
          slug: parsed.data.skillSlug.toLowerCase(),
          name: parsed.data.skillSlug,
          summary: "Debug screen test upload",
          instructions: "N/A -- created automatically for a Debug-screen test recording.",
          category: "GENERAL",
          reward: 0,
          isCustom: true,
          createdByUserId: userId,
        },
      });
    } catch {
      skill = await prisma.skillDefinition.findFirst({
        where: { slug: { equals: parsed.data.skillSlug, mode: "insensitive" } },
      });
    }
  }

  if (!skill || !skill.active) {
    return NextResponse.json({ error: "Unknown skill" }, { status: 400 });
  }

  if (!parsed.data.debug && skill.reward > 0 && (parsed.data.durationSec ?? 0) < MIN_PAID_RECORDING_SEC) {
    return NextResponse.json(
      { error: `Recording must be at least ${MIN_PAID_RECORDING_SEC} seconds long for a paid skill` },
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
      sizeBytes: parsed.data.sizeBytes,
    },
    include: { skill: true },
  });

  return NextResponse.json({ collection }, { status: 201 });
}
