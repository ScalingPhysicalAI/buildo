import type { SkillCollectionSession } from "./skills-api";

export type DisplayStatus = "available" | "uploaded" | "training" | "trained" | "failed";

export function getDisplayStatus(collection: SkillCollectionSession | null): DisplayStatus {
  if (!collection) return "available";
  if (collection.status === "UPLOADED") return "uploaded";
  if (collection.status === "TRAINING") return "training";
  if (collection.status === "TRAINED") return "trained";
  return "failed";
}

export function formatTimeLeft(trainEndsAt: string | null): string {
  if (!trainEndsAt) return "";
  const msLeft = new Date(trainEndsAt).getTime() - Date.now();
  if (msLeft <= 0) return "Finishing…";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((msLeft % (60 * 1000)) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}
