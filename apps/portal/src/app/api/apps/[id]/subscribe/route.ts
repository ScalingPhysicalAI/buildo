import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { skillSubscribeSchema } from "@/lib/validations";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// A robot owner's paid subscription to a skill (apps/owner Store) -- not to
// be confused with POST /api/apps/[id]/install, which is the free creator-
// dashboard "distinct installers" counter and is left untouched. Compulsory
// gate: the caller's own robot rent (User.rentPaidUntil) must be currently
// paid, same rule the Store screen itself enforces client-side -- enforced
// again here since this moves real money.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = skillSubscribeSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { months } = parsed.data;

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { ownerWalletBalance: true, rentPaidUntil: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const now = new Date();
  if (!owner.rentPaidUntil || owner.rentPaidUntil.getTime() <= now.getTime()) {
    return NextResponse.json({ error: "Pay your robot rent before subscribing to skills" }, { status: 403 });
  }

  const { id: appId } = await params;
  const app = await prisma.appListing.findUnique({
    where: { id: appId },
    select: { name: true, status: true, userId: true, monthlySubscriptionPriceUsd: true },
  });
  if (!app || app.status !== "LIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const totalCost = app.monthlySubscriptionPriceUsd * months;
  if (owner.ownerWalletBalance < totalCost) {
    return NextResponse.json(
      { error: `Top up at least $${totalCost} to subscribe for ${months} month${months === 1 ? "" : "s"}` },
      { status: 400 }
    );
  }

  const existing = await prisma.skillSubscription.findUnique({
    where: { userId_appId: { userId, appId } },
    select: { subscribedUntil: true },
  });
  const base = existing && existing.subscribedUntil.getTime() > now.getTime() ? existing.subscribedUntil : now;
  const subscribedUntil = new Date(base.getTime() + months * MONTH_MS);

  const [updatedOwner] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { ownerWalletBalance: { decrement: totalCost } },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId,
        type: "SKILL_SUBSCRIPTION",
        amount: -totalCost,
        wallet: "OWNER",
        note: `Skill subscription: ${app.name} -- ${months} month${months === 1 ? "" : "s"}`,
      },
    }),
    prisma.skillSubscription.upsert({
      where: { userId_appId: { userId, appId } },
      create: { userId, appId, monthlyPriceUsd: app.monthlySubscriptionPriceUsd, subscribedUntil },
      update: { monthlyPriceUsd: app.monthlySubscriptionPriceUsd, subscribedUntil },
    }),
    // Full passthrough to the creator -- same no-platform-cut model as
    // APP_EARNINGS on a free install, just funded by a real debit this time.
    prisma.user.update({
      where: { id: app.userId },
      data: { tokenBalance: { increment: totalCost } },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId: app.userId,
        type: "APP_EARNINGS",
        amount: totalCost,
        note: `Skill subscription: ${app.name}`,
      },
    }),
    prisma.appListing.update({
      where: { id: appId },
      data: { earnings: { increment: totalCost } },
    }),
  ]);

  return NextResponse.json({
    user: toSafeUser(updatedOwner),
    subscribedUntil,
    monthlyPriceUsd: app.monthlySubscriptionPriceUsd,
  });
}
