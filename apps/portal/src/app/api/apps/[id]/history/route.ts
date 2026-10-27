import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_WINDOW_DAYS = 14;

// Creator-only earnings/subscriber trend for one of their own apps, built
// from the append-only SkillSubscriptionPayment log (one row per
// subscribe/renew call) rather than any snapshot or cron -- there's nothing
// to schedule, just a read over existing rows. Powers the sparkline + 30/90
// day totals on apps/mobile's build/[id].tsx.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: appId } = await params;
  const app = await prisma.appListing.findUnique({
    where: { id: appId },
    select: { userId: true },
  });
  if (!app || app.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * DAY_MS);

  const payments = await prisma.skillSubscriptionPayment.findMany({
    where: { appId, createdAt: { gte: since90 } },
    select: { amountUsd: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const last30 = payments.filter((p) => p.createdAt >= since30);
  const last90 = payments;

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dailyTotals = new Map<string, number>();
  for (const p of payments) {
    const key = dayKey(p.createdAt);
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + p.amountUsd);
  }
  const daily = Array.from({ length: DAILY_WINDOW_DAYS }, (_, i) => {
    const d = new Date(now.getTime() - (DAILY_WINDOW_DAYS - 1 - i) * DAY_MS);
    const key = dayKey(d);
    return { date: key, revenue: dailyTotals.get(key) ?? 0 };
  });

  return NextResponse.json({
    last30: { revenue: last30.reduce((s, p) => s + p.amountUsd, 0), payments: last30.length },
    last90: { revenue: last90.reduce((s, p) => s + p.amountUsd, 0), payments: last90.length },
    daily,
  });
}
