import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { rentPlanSchema } from "@/lib/validations";

// Per-month rate by term length, direct vs. referred (User.referredById set
// at signup -- see /api/auth/signup). Longer terms step the rate down by
// $60/mo regardless of referral status; the referral discount is a flat
// $100/mo off at every term. Kept in sync by hand with the display copy of
// this table in apps/owner/src/app/settings/rent-plan.tsx -- no shared
// package between the two yet.
const RENT_PRICING: Record<3 | 6 | 12, { direct: number; referred: number }> = {
  3: { direct: 600, referred: 500 },
  6: { direct: 540, referred: 440 },
  12: { direct: 480, referred: 380 },
};

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Starts or changes the caller's robot rental plan: locks in a monthly rate
// from their referral status + the chosen term, debits the first month from
// ownerWalletBalance immediately, and marks rent paid for the next 30 days.
// Changing plans (picking a new term later) always re-prices from now --
// it does not carry over any remaining paid time from the old plan.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = rentPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referredById: true, ownerWalletBalance: true, rentStartedAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { termMonths } = parsed.data;
  const monthlyRentUsd = user.referredById ? RENT_PRICING[termMonths].referred : RENT_PRICING[termMonths].direct;
  if (user.ownerWalletBalance < monthlyRentUsd) {
    return NextResponse.json(
      { error: `Top up at least $${monthlyRentUsd} to cover the first month's rent` },
      { status: 400 }
    );
  }

  const now = new Date();

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        rentTermMonths: termMonths,
        monthlyRentUsd,
        rentStartedAt: user.rentStartedAt ?? now,
        rentPaidUntil: new Date(now.getTime() + MONTH_MS),
        ownerWalletBalance: { decrement: monthlyRentUsd },
      },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId,
        type: "ROBOT_RENT",
        amount: -monthlyRentUsd,
        wallet: "OWNER",
        note: `Robot rental started -- ${termMonths} month term, first month`,
      },
    }),
  ]);

  return NextResponse.json({ user: toSafeUser(updatedUser) });
}
