import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { appListingCreateSchema } from "@/lib/validations";
import { resolveCollectionStatuses } from "@/lib/skill-collection";
import { resolveAppStatuses } from "@/lib/app-testing";

export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apps = await prisma.appListing.findMany({
    where: { userId },
    include: {
      skills: { include: { skillCollection: { include: { skill: true } } } },
      _count: { select: { installs: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const resolved = await resolveAppStatuses(apps);

  return NextResponse.json({
    apps: resolved.map(({ _count, ...app }) => ({ ...app, installCount: _count.installs })),
  });
}

// Creates a draft app listing from a chosen set of the developer's own
// uploaded skill-collection sessions. The TRAINING/TRAINED timer step is
// skipped for now (see skill-collection.ts) -- any upload that hasn't
// FAILED is usable in an app. Deploying (running the automated
// certification + going live) is a separate step -- POST /api/apps/:id/deploy.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = appListingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const candidates = await prisma.skillCollectionSession.findMany({
    where: { id: { in: parsed.data.skillCollectionIds }, userId },
  });
  const resolved = await resolveCollectionStatuses(candidates);

  if (resolved.length !== parsed.data.skillCollectionIds.length) {
    return NextResponse.json({ error: "One or more skills weren't found" }, { status: 400 });
  }
  const failed = resolved.find((c) => c.status === "FAILED");
  if (failed) {
    return NextResponse.json(
      { error: "One of these skills failed and needs to be recorded again" },
      { status: 409 }
    );
  }

  const app = await prisma.appListing.create({
    data: {
      userId,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      skills: {
        create: parsed.data.skillCollectionIds.map((skillCollectionId) => ({ skillCollectionId })),
      },
    },
    include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
  });

  return NextResponse.json({ app }, { status: 201 });
}
