import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// Renews the caller's already-chosen plan for one more full term, at the
// rate locked in when the plan was (re)started (see POST /api/robot-rental)
// -- this endpoint never changes term or rate. Charges monthlyRentUsd *
// rentTermMonths upfront again, same as the initial payment, and extends
// rentPaidUntil by that many months. Extends from the current rentPaidUntil
// if it's still in the future (paying early doesn't waste remaining time),
// or from now if rent has lapsed.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { monthlyRentUsd: true, rentTermMonths: true, ownerWalletBalance: true, rentPaidUntil: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!user.monthlyRentUsd || !user.rentTermMonths) {
    return NextResponse.json({ error: "Choose a rental plan first" }, { status: 400 });
  }

  const totalCost = user.monthlyRentUsd * user.rentTermMonths;
  if (user.ownerWalletBalance < totalCost) {
    return NextResponse.json(
      { error: `Top up at least $${totalCost} to renew your ${user.rentTermMonths}-month term` },
      { status: 400 }
    );
  }

  const now = new Date();
  const base = user.rentPaidUntil && user.rentPaidUntil.getTime() > now.getTime() ? user.rentPaidUntil : now;

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        rentPaidUntil: new Date(base.getTime() + user.rentTermMonths * MONTH_MS),
        ownerWalletBalance: { decrement: totalCost },
      },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId,
        type: "ROBOT_RENT",
        amount: -totalCost,
        wallet: "OWNER",
        note: `Robot rental renewed -- ${user.rentTermMonths} month term, paid in full`,
      },
    }),
  ]);

  return NextResponse.json({ user: toSafeUser(updatedUser) });
}
