// Talks to the portal's /api/skills and /api/apps routes -- the record-a-
// skill-for-pay catalog, the 24h training timer, and the app builder. Same
// bearer-token request() helper as api.ts.

import { request } from "./api";
import type { SafeUser } from "./api";

export type CollectionStatus = "UPLOADED" | "TRAINING" | "TRAINED" | "FAILED";

export interface SkillDefinition {
  id: string;
  slug: string;
  name: string;
  summary: string;
  instructions: string;
  category: string;
  reward: number;
  active: boolean;
  isCustom: boolean;
  createdAt: string;
}

export interface SkillCollectionSession {
  id: string;
  userId: string;
  skillId: string;
  status: CollectionStatus;
  fileName: string | null;
  durationSec: number | null;
  rewardPaid: boolean;
  trainStartedAt: string | null;
  trainEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  skill?: SkillDefinition;
}

export interface SkillCatalogEntry extends SkillDefinition {
  collection: SkillCollectionSession | null;
}

export async function fetchSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const data = await request<{ skills: SkillCatalogEntry[] }>("/api/skills/catalog");
  return data.skills;
}

export async function fetchSkillCollections(): Promise<SkillCollectionSession[]> {
  const data = await request<{ collections: SkillCollectionSession[] }>("/api/skills/collections");
  return data.collections;
}

export async function createSkillCollection(
  skillSlug: string,
  fileName?: string,
  durationSec?: number
): Promise<SkillCollectionSession> {
  const data = await request<{ collection: SkillCollectionSession }>("/api/skills/collections", {
    method: "POST",
    body: JSON.stringify({ skillSlug, fileName, durationSec }),
  });
  return data.collection;
}

export async function startTraining(collectionId: string): Promise<SkillCollectionSession> {
  const data = await request<{ collection: SkillCollectionSession }>(
    `/api/skills/collections/${collectionId}/train`,
    { method: "POST" }
  );
  return data.collection;
}

export async function createCustomSkill(name: string): Promise<SkillDefinition> {
  const data = await request<{ skill: SkillDefinition }>("/api/skills/custom", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.skill;
}

export type AppCategory = "HOME" | "SHOP" | "OFFICE" | "WAREHOUSE" | "HOSPITAL";
export type AppDeployStatus = "DRAFT" | "TESTING" | "PASSED" | "FAILED" | "LIVE";

export interface AppTestReport {
  passed: boolean;
  checks: { id: string; label: string; passed: boolean }[];
  metrics: { taskSuccessRate: number; skillCount: number };
  ranAt: string;
}

export interface AppListingSkill {
  id: string;
  skillCollectionId: string;
  skillCollection: SkillCollectionSession & { skill: SkillDefinition };
}

export interface AppListing {
  id: string;
  name: string;
  description: string | null;
  category: AppCategory;
  iconUrl: string | null;
  videoUrl: string | null;
  status: AppDeployStatus;
  testReport: AppTestReport | null;
  publishedAt: string | null;
  testingEndsAt: string | null;
  earnings: number;
  installCount: number;
  createdAt: string;
  skills: AppListingSkill[];
}

export interface AppStoreListing extends Omit<AppListing, "earnings"> {
  user: { id: string; name: string };
  installedByMe: boolean;
}

export async function fetchApps(): Promise<AppListing[]> {
  const data = await request<{ apps: AppListing[] }>("/api/apps");
  return data.apps;
}

export async function fetchAppStore(): Promise<AppStoreListing[]> {
  const data = await request<{ apps: AppStoreListing[] }>("/api/app-store");
  return data.apps;
}

export async function installApp(id: string): Promise<{ installCount: number }> {
  return request<{ installCount: number }>(`/api/apps/${id}/install`, { method: "POST" });
}

export async function createApp(input: {
  name: string;
  description?: string;
  category: AppCategory;
  skillCollectionIds: string[];
}): Promise<AppListing> {
  const data = await request<{ app: AppListing }>("/api/apps", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.app;
}

export async function deployApp(id: string): Promise<{ app: AppListing; user?: SafeUser }> {
  return request<{ app: AppListing; user?: SafeUser }>(`/api/apps/${id}/deploy`, { method: "POST" });
}

export async function deleteApp(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/apps/${id}`, { method: "DELETE" });
}

export async function publishApp(id: string): Promise<{ user: SafeUser; app: AppListing }> {
  return request<{ user: SafeUser; app: AppListing }>(`/api/apps/${id}/publish`, { method: "POST" });
}
