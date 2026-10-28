import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

function generateCode() {
  return `BLD${randomBytes(4).toString("hex").toUpperCase()}`;
}

// Returns the user's referral code, generating and persisting one on first
// call. Retries on the (vanishingly rare) chance of a collision with another
// user's code, since the column is unique.
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (existing?.referralCode) {
    return NextResponse.json({ code: existing.referralCode });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: generateCode() },
        select: { referralCode: true },
      });
      return NextResponse.json({ code: user.referralCode });
    } catch {
      // Unique constraint collision -- retry with a freshly generated code.
    }
  }

  return NextResponse.json({ error: "Couldn't generate a referral code" }, { status: 500 });
}
