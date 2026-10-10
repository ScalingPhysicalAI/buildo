import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { resolveAppStatuses } from "@/lib/app-testing";

// Public app store listing -- every LIVE app, across every developer, with
// its skills and distinct install count. Earnings are deliberately left off
// this response: that's private to the app's own creator (see /api/apps).
// Apps still in their 7-day TESTING window are included in the initial
// query (so one about to flip to LIVE is resolved here too) and filtered
// back out below if they're still testing after resolution.
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apps = await prisma.appListing.findMany({
    where: { status: { in: ["TESTING", "LIVE"] } },
    orderBy: { publishedAt: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      skills: { include: { skillCollection: { include: { skill: true } } } },
      _count: { select: { installs: true } },
      installs: { where: { userId }, select: { id: true } },
    },
  });
  const resolved = (await resolveAppStatuses(apps)).filter((app) => app.status === "LIVE");

  return NextResponse.json({
    apps: resolved.map(({ installs, _count, earnings: _earnings, ...app }) => ({
      ...app,
      installCount: _count.installs,
      installedByMe: installs.length > 0,
    })),
  });
}
