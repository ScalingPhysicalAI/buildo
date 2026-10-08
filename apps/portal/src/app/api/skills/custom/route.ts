import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/auth";
import { customSkillCreateSchema } from "@/lib/validations";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `custom-${base || "skill"}-${randomBytes(3).toString("hex")}`;
}

// A developer-typed, unpaid skill -- visible only to its own creator (see
// the isCustom/createdByUserId filter in GET /api/skills/catalog). Goes
// through the exact same record -> upload -> train -> trained pipeline as a
// predefined skill, just with reward 0, so it can still be used in an app.
export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = customSkillCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const skill = await prisma.skillDefinition.create({
    data: {
      slug: slugify(parsed.data.name),
      name: parsed.data.name,
      summary: "Custom skill",
      instructions:
        "Wear your capture glasses and gloves, then start the recording and perform the task from start to finish.",
      category: "GENERAL",
      reward: 0,
      isCustom: true,
      createdByUserId: userId,
    },
  });

  return NextResponse.json({ skill }, { status: 201 });
}
