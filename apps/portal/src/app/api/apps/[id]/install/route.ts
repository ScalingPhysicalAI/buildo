import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

// Placeholder monetization rule -- $ credited to the app's creator per
// distinct install. No real pricing model was specified; flagged as the one
// number in this route that's a guess, not a spec.
const EARNINGS_PER_INSTALL = 2;

// Simulates a public user installing a LIVE app from the app store. Real
// distribution (an actual installable build reaching a device) doesn't
// exist yet -- this is the same "real ledger, simulated trigger" shape as
// GpuSession, so downloads/earnings numbers are genuine and testable before
// a real store front-end exists.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const app = await prisma.appListing.findUnique({ where: { id } });
  if (!app || app.status !== "LIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await prisma.$transaction([
      prisma.appInstall.create({ data: { appId: id, userId } }),
      prisma.appListing.update({
        where: { id },
        data: { earnings: { increment: EARNINGS_PER_INSTALL } },
      }),
      prisma.user.update({
        where: { id: app.userId },
        data: { tokenBalance: { increment: EARNINGS_PER_INSTALL } },
      }),
      prisma.tokenTransaction.create({
        data: {
          userId: app.userId,
          type: "APP_EARNINGS",
          amount: EARNINGS_PER_INSTALL,
          note: `Install: ${app.name}`,
        },
      }),
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
