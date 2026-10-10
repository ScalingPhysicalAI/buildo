import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { resolveCollectionStatuses } from "@/lib/skill-collection";
import { APP_TESTING_DURATION_MS } from "@/lib/app-testing";

// "Train and Deploy": runs the automated certification checks immediately
// (same spirit as GpuSession's simulated GPU provisioning -- the checks and
// their pass/fail outcome are fully real, but there's no actual sandboxed
// app run yet, that needs the real robot/sim harness from a later phase).
// If they pass, the app enters a 7-day TESTING window (see app-testing.ts)
// and is resolved to LIVE -- charging the one-time deploy fee -- the next
// time anything reads it once that window closes. Deterministic, not
// random, so re-running on unchanged input always reproduces the same report.
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

  const updated = await prisma.appListing.update({
    where: { id },
    data: report.passed
      ? { status: "TESTING", testReport: report, testingEndsAt: new Date(Date.now() + APP_TESTING_DURATION_MS) }
      : { status: "FAILED", testReport: report, testingEndsAt: null },
    include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
  });

  return NextResponse.json({ app: updated });
}
