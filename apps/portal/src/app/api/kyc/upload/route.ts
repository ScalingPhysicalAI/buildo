import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};

// Government ID photo for KYC, required before a creator can order the
// Buildo Development Kit on credit (see MIN_WALLET_BALANCE in
// gadgets/order/route.ts). Stored as a private blob -- reading it back
// requires BLOB_READ_WRITE_TOKEN, not just the URL -- since this is
// sensitive personal data, not a public asset. The random filename is just
// hygiene at that point, not the real access control.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "File storage isn't configured on the server yet" },
      { status: 503 }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG, HEIC, or WEBP image" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Image must be under 8MB" }, { status: 400 });
  }

  const blob = await put(`kyc/${randomUUID()}.${extension}`, file, {
    access: "private",
    contentType: file.type,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { kycIdImageUrl: blob.url, kycSubmittedAt: new Date() },
  });

  return NextResponse.json({ url: blob.url });
}
