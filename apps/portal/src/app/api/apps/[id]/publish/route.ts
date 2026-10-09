import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";

const DEPLOY_FEE = 5;

// The actual "go live on the app store" step. Only reachable once the
// automated test has passed (POST /api/apps/:id/deploy) -- charges the
// one-time $5 publish fee and flips the app to LIVE. Re-publishing an
// already LIVE app is a no-op rather than double-charging.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const app = await prisma.appListing.findUnique({ where: { id } });
  if (!app || app.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (app.status === "LIVE") {
    return NextResponse.json({ error: "This app is already live" }, { status: 409 });
  }
  if (app.status !== "PASSED") {
    return NextResponse.json({ error: "Run certification first" }, { status: 409 });
  }

  try {
    const [updatedUser, updatedApp] = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("NOT_FOUND");
      if (user.tokenBalance < DEPLOY_FEE) throw new Error("INSUFFICIENT_BALANCE");

      const user2 = await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: { decrement: DEPLOY_FEE } },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          type: "APP_DEPLOY_FEE",
          amount: -DEPLOY_FEE,
          note: `Deploy fee: ${app.name}`,
        },
      });

      const app2 = await tx.appListing.update({
        where: { id },
        data: { status: "LIVE", publishedAt: new Date() },
        include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
      });

      return [user2, app2] as const;
    });

    return NextResponse.json({ user: toSafeUser(updatedUser), app: updatedApp });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: `You need $${DEPLOY_FEE} credit to deploy` }, { status: 402 });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }
}
