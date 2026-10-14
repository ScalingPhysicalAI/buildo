import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { walletTopupSchema } from "@/lib/validations";

// Credits the caller's own $ balance directly -- there is no payment
// processor behind this yet (see TokenTransaction in schema.prisma, which is
// an off-chain ledger for now). Same shape as every other credit path in
// this app (SIGNUP_BONUS, APP_EARNINGS, ...), just user-initiated.
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
      data: { tokenBalance: { increment: amountUsd } },
    }),
    prisma.tokenTransaction.create({
      data: {
        userId,
        type: "WALLET_TOPUP",
        amount: amountUsd,
        note: "Wallet top-up",
      },
    }),
  ]);

  return NextResponse.json({ user: toSafeUser(updatedUser) });
}
