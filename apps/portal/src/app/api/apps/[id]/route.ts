import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

// Deletes one of the developer's own apps (any status, including LIVE --
// the AppListingSkill/AppInstall rows cascade-delete with it, so this
// never leaves orphaned rows).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const app = await prisma.appListing.findUnique({ where: { id } });
  if (!app || app.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.appListing.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
