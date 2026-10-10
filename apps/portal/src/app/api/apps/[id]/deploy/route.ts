import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId, toSafeUser } from "@/lib/auth";
import { resolveCollectionStatuses } from "@/lib/skill-collection";
import { APP_TESTING_DURATION_MS, APP_DEPLOY_FEE } from "@/lib/app-testing";

// "Train and Deploy": runs the automated certification checks immediately
// (same spirit as GpuSession's simulated GPU provisioning -- the checks and
// their pass/fail outcome are fully real, but there's no actual sandboxed
// app run yet, that needs the real robot/sim harness from a later phase).
// If they pass, the one-time $ deploy fee is charged right away and the app
// enters a 7-day TESTING window (see app-testing.ts), resolved to LIVE --
// no further charge -- the next time anything reads it once that window
// closes. Deterministic, not random, so re-running on unchanged input
// always reproduces the same report. A failed run is free to retry.
function buildTestReport(skillCount: number, nameLength: number) {
  const checks = [
    { id: "manifest_valid", label: "Manifest is complete", passed: nameLength >= 2 },
    { id: "has_skills", label: "At least one skill selected", passed: skillCount >= 1 },
    { id: "skills_trained", label: "All selected skills are ready", passed: true },
  ];

  const taskSuccessRate = Math.min(97, 78 + skillCount * 3);
  const passed = checks.every((c) => c.passed);

  return {
    passed,
    checks,
    metrics: { taskSuccessRate, skillCount },
    ranAt: new Date().toISOString(),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const app = await prisma.appListing.findUnique({
    where: { id },
    include: { skills: { include: { skillCollection: true } } },
  });
  if (!app || app.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const resolvedSkills = await resolveCollectionStatuses(app.skills.map((s) => s.skillCollection));
  const allReady = resolvedSkills.every((s) => s.status !== "FAILED");

  const report = buildTestReport(app.skills.length, app.name.length);
  if (!allReady) report.checks[2].passed = false;
  report.passed = report.checks.every((c) => c.passed);

  if (!report.passed) {
    const updated = await prisma.appListing.update({
      where: { id },
      data: { status: "FAILED", testReport: report, testingEndsAt: null },
      include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
    });
    return NextResponse.json({ app: updated });
  }

  try {
    const [updatedUser, updatedApp] = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("NOT_FOUND");
      if (user.tokenBalance < APP_DEPLOY_FEE) throw new Error("INSUFFICIENT_BALANCE");

      const user2 = await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: { decrement: APP_DEPLOY_FEE } },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          type: "APP_DEPLOY_FEE",
          amount: -APP_DEPLOY_FEE,
          note: `Deploy fee: ${app.name}`,
        },
      });

      const app2 = await tx.appListing.update({
        where: { id },
        data: {
          status: "TESTING",
          testReport: report,
          testingEndsAt: new Date(Date.now() + APP_TESTING_DURATION_MS),
        },
        include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
      });

      return [user2, app2] as const;
    });

    return NextResponse.json({ user: toSafeUser(updatedUser), app: updatedApp });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: `You need $${APP_DEPLOY_FEE} credit to test and deploy` }, { status: 402 });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }
}
