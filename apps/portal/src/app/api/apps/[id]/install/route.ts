import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

// Simulates a public user installing a LIVE app from the app store. Real
// distribution (an actual installable build reaching a device) doesn't
// exist yet -- this is the same "real ledger, simulated trigger" shape as
// GpuSession, so downloads/earnings numbers are genuine and testable before
// a real store front-end exists.
//
// This is also where a skill's reward is actually realized: recording and
// uploading a skill pays nothing by itself (see POST /api/skills/collections)
// -- the creator only earns once that skill is part of a published app and
// someone else installs it, and they earn it again on every subsequent
// install. The amount per install is the sum of the rewards of every skill
// bundled into the app.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const app = await prisma.appListing.findUnique({
    where: { id },
    include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
  });
  if (!app || app.status !== "LIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const earningsPerInstall = app.skills.reduce((sum, s) => sum + s.skillCollection.skill.reward, 0);

  try {
    await prisma.$transaction([
      prisma.appInstall.create({ data: { appId: id, userId } }),
      prisma.appListing.update({
        where: { id },
        data: { earnings: { increment: earningsPerInstall } },
      }),
      ...(earningsPerInstall > 0
        ? [
            prisma.user.update({
              where: { id: app.userId },
              data: { tokenBalance: { increment: earningsPerInstall } },
            }),
            prisma.tokenTransaction.create({
              data: {
                userId: app.userId,
                type: "APP_EARNINGS" as const,
                amount: earningsPerInstall,
                note: `Install: ${app.name}`,
              },
            }),
          ]
        : []),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "You've already installed this app" }, { status: 409 });
    }
    throw err;
  }

  const installCount = await prisma.appInstall.count({ where: { appId: id } });
  return NextResponse.json({ installCount });
}
