import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { sendOrderConfirmationEmail } from "@/lib/mailer";
import { gadgetOrderSchema } from "@/lib/validations";

// Real price of the Buildo Development Kit (starforgerobotics.com/buildo-development-kit/).
export const GADGET_KIT_PRICE = 499;

// "Use wallet" is a direct-debit purchase path, not a real checkout -- it
// charges the kit price straight out of the buyer's $ credit balance and is
// allowed to push that balance negative (financing the purchase against
// future earnings), but only down to this floor.
const MIN_WALLET_BALANCE = -500;

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

    return NextResponse.json({ user: toSafeUser(updatedUser), order });
  } catch (err) {
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
