import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { resolveAppStatuses } from "@/lib/app-testing";

// Truly public marketplace listing -- works with no auth at all. This is
// deliberately separate from GET /api/app-store (which requires a creator
// session and returns installedByMe/skills for the mobile creators app) --
// that route is left untouched. This one powers the Buildo *owner* app's
// Store tab (apps/owner). A bearer token is optional: when present (the
// owner app always sends one once logged in), the response also includes
// mySubscribedUntil per app from SkillSubscription, so the client can show
// subscribed/expired state without a second round trip. Never exposes
// earnings, test reports, or the creator's userId.
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);

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

  const mySubscriptions = userId
    ? await prisma.skillSubscription.findMany({
        where: { userId, appId: { in: live.map((app) => app.id) } },
        select: { appId: true, subscribedUntil: true },
      })
    : [];
  const subscribedUntilByAppId = new Map(mySubscriptions.map((s) => [s.appId, s.subscribedUntil]));

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
      monthlyPriceUsd: app.monthlySubscriptionPriceUsd,
      mySubscribedUntil: subscribedUntilByAppId.get(app.id) ?? null,
    })),
  });
}
