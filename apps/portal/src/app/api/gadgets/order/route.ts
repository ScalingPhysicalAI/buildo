import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { sendOrderAlertEmail, sendOrderConfirmationEmail } from "@/lib/mailer";
import { gadgetOrderSchema } from "@/lib/validations";

// Price of the Buildo Development Kit, in $ credit.
export const GADGET_KIT_PRICE = 200;

// "Use wallet" is a direct-debit purchase path, not a real checkout -- it
// charges the kit price straight out of the buyer's $ credit balance and is
// allowed to push that balance negative (financing the purchase against
// future earnings), but only down to this floor.
const MIN_WALLET_BALANCE = -500;

// "Buy now & pay later" is a one-time scheme -- once a developer has an
// order on file, the Home screen's gadgets banner stops offering it again.
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const order = await prisma.gadgetOrder.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ hasOrder: !!order, order });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = gadgetOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  try {
    const [updatedUser, order] = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("NOT_FOUND");
      if (!user.kycIdImageUrl) throw new Error("KYC_REQUIRED");

      const newBalance = user.tokenBalance - GADGET_KIT_PRICE;
      if (newBalance < MIN_WALLET_BALANCE) {
        throw new Error("BALANCE_FLOOR");
      }

      const user2 = await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: newBalance },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          type: "GADGET_PURCHASE",
          amount: -GADGET_KIT_PRICE,
          note: "Buildo Development Kit (wallet order)",
        },
      });

      const order2 = await tx.gadgetOrder.create({
        data: {
          userId,
          recipientName: parsed.data.recipientName,
          recipientEmail: parsed.data.recipientEmail,
          phone: parsed.data.phone,
          shippingAddress: parsed.data.shippingAddress,
          price: GADGET_KIT_PRICE,
        },
      });

      return [user2, order2] as const;
    });

    sendOrderConfirmationEmail(order.recipientEmail, order.recipientName, {
      price: order.price,
      shippingAddress: order.shippingAddress,
      newBalance: updatedUser.tokenBalance,
    }).catch((err) => console.error("[gadgets/order] confirmation email failed:", err));

    sendOrderAlertEmail({
      recipientName: order.recipientName,
      recipientEmail: order.recipientEmail,
      phone: order.phone ?? "Not provided",
      shippingAddress: order.shippingAddress,
      price: order.price,
      accountEmail: updatedUser.email,
    }).catch((err) => console.error("[gadgets/order] staff alert email failed:", err));

    return NextResponse.json({ user: toSafeUser(updatedUser), order });
  } catch (err) {
    if (err instanceof Error && err.message === "KYC_REQUIRED") {
      return NextResponse.json(
        { error: "Upload a government ID to verify your identity before ordering" },
        { status: 403 }
      );
    }
    if (err instanceof Error && err.message === "BALANCE_FLOOR") {
      return NextResponse.json(
        { error: `This order would take your wallet balance past the $${MIN_WALLET_BALANCE} limit` },
        { status: 402 }
      );
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }
}
