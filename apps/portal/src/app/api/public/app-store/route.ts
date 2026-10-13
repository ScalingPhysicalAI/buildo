import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveAppStatuses } from "@/lib/app-testing";

// Truly public marketplace listing -- no auth at all. This is deliberately
// separate from GET /api/app-store (which requires a creator session and
// returns installedByMe/skills for the mobile creators app) -- that route
// is left untouched. This one powers the Buildo *owner* app's Store tab
// (apps/owner), which has no real account system yet, so it can't be gated
// behind a session. Only exposes what a robot owner needs to browse/
// install: never earnings, test reports, or the creator's userId.
export async function GET() {
  // TESTING apps are included as candidates so one that's crossed its
  // testingEndsAt window gets lazily flipped to LIVE here too (same
  // resolve-on-read pattern as GET /api/apps), not just when its own
  // creator happens to check it first.
  const candidates = await prisma.appListing.findMany({
    where: { status: { in: ["TESTING", "LIVE"] } },
    include: {
      user: { select: { name: true } },
      _count: { select: { installs: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const resolved = await resolveAppStatuses(candidates);
  const live = resolved.filter((app) => app.status === "LIVE");

  return NextResponse.json({
    apps: live.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      category: app.category,
      iconUrl: app.iconUrl,
      installCount: app._count.installs,
      creatorName: app.user.name,
      publishedAt: app.publishedAt,
    })),
  });
}
