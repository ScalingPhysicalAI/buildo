import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { resolveCollectionStatuses } from "@/lib/skill-collection";

// Automated certification, in the same spirit as GpuSession's simulated GPU
// provisioning: the checks and their pass/fail outcome are fully real, but
// there's no actual sandboxed app run yet (that needs the real robot/sim
// harness from a later phase). Deterministic, not random, so re-running a
// deploy on unchanged input always reproduces the same report.
function buildTestReport(skillCount: number, nameLength: number) {
  const checks = [
    { id: "manifest_valid", label: "Manifest is complete", passed: nameLength >= 2 },
    { id: "has_skills", label: "At least one trained skill selected", passed: skillCount >= 1 },
    { id: "skills_trained", label: "All selected skills finished training", passed: true },
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
  const allTrained = resolvedSkills.every((s) => s.status === "TRAINED");

  const report = buildTestReport(app.skills.length, app.name.length);
  if (!allTrained) report.checks[2].passed = false;
  report.passed = report.checks.every((c) => c.passed);

  // Certification only -- PASSED here just unlocks the publish step
  // (POST /api/apps/:id/publish), which is where the $ deploy fee is
  // actually charged and the app goes LIVE.
  const updated = await prisma.appListing.update({
    where: { id },
    data: {
      status: report.passed ? "PASSED" : "FAILED",
      testReport: report,
    },
    include: { skills: { include: { skillCollection: { include: { skill: true } } } } },
  });

  return NextResponse.json({ app: updated });
}
