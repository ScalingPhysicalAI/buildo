import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

// Public app store listing -- every LIVE app, across every developer, with
// its skills and distinct install count. Earnings are deliberately left off
// this response: that's private to the app's own creator (see /api/apps).
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apps = await prisma.appListing.findMany({
    where: { status: "LIVE" },
    orderBy: { publishedAt: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      skills: { include: { skillCollection: { include: { skill: true } } } },
      _count: { select: { installs: true } },
      installs: { where: { userId }, select: { id: true } },
    },
  });

  return NextResponse.json({
    apps: apps.map(({ installs, _count, earnings: _earnings, ...app }) => ({
      ...app,
      installCount: _count.installs,
      installedByMe: installs.length > 0,
    })),
  });
}
