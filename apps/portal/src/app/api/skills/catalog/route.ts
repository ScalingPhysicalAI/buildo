import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { resolveCollectionStatuses } from "@/lib/skill-collection";

// The Record tab's skill picker: every active predefined skill, plus the
// current user's own collection status for it (if they've ever recorded
// one), so the mobile app can show AVAILABLE/UPLOADED/TRAINING/TRAINED
// directly in the list without a second round trip per skill.
export async function GET(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [skills, collections] = await Promise.all([
    prisma.skillDefinition.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    prisma.skillCollectionSession.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  const resolved = await resolveCollectionStatuses(collections);
  const bySkillId = new Map(resolved.map((c) => [c.skillId, c]));

  return NextResponse.json({
    skills: skills.map((skill) => ({
      ...skill,
      collection: bySkillId.get(skill.id) ?? null,
    })),
  });
}
