import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { walletTopupSchema } from "@/lib/validations";

// Credits the caller's robot-owner wallet (User.ownerWalletBalance) -- a
// separate pool from the creator $ balance (User.tokenBalance) used by
// apps/mobile and the portal. Same login can have both, but the money is
// never shared. There is no payment processor behind this yet (see
// TokenTransaction in schema.prisma, which is an off-chain ledger for now).
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = walletTopupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { amountUsd } = parsed.data;

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { ownerWalletBalance: { increment: amountUsd } },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId,
        type: "WALLET_TOPUP",
        amount: amountUsd,
        wallet: "OWNER",
        note: "Wallet top-up",
      },
    }),
  ]);

  return NextResponse.json({ user: toSafeUser(updatedUser) });
}
