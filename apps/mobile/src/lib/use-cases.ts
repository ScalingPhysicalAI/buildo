// The Train tab's top-level picker: which "robot app" is the user training
// skills for. Each use case maps 1:1 to an AppCategory and lists the
// predefined skill slugs required to finish it. Pairing your capture gear
// is NOT one of these -- that's gated at the point you actually try to
// record (see skill/[slug].tsx), same as before this feature existed.
import type { AppCategory } from "./skills-api";

export interface UseCase {
  key: AppCategory;
  title: string;
  description: string;
  skillSlugs: string[];
}

export const USE_CASES: UseCase[] = [
  {
    key: "HOME",
    title: "Home",
    description: "Train Buildo to work in your home",
    skillSlugs: ["wash-dish", "pour-coffee", "load-washing-machine", "fold-towel", "wipe-counter"],
  },
  {
    key: "SHOP",
    title: "Shops",
    description: "Train Buildo to assist in retail shops",
    skillSlugs: ["greet-and-handoff", "sort-pantry-items", "scan-and-bag-item", "restock-shelf"],
  },
  {
    key: "OFFICE",
    title: "Offices",
    description: "Train Buildo to help around the office",
    skillSlugs: ["water-plant", "deliver-mail-to-desk", "tidy-meeting-room", "restock-supply-cabinet"],
  },
  {
    key: "WAREHOUSE",
    title: "Warehouses",
    description: "Train Buildo for warehouse logistics",
    skillSlugs: ["scan-and-palletize-box", "pick-item-for-order", "label-and-seal-package", "load-truck-dock"],
  },
  {
    key: "HOSPITAL",
    title: "Hospitals",
    description: "Train Buildo to support hospital staff",
    skillSlugs: ["deliver-meal-tray", "restock-supply-cart", "sanitize-surface", "fetch-and-deliver-item"],
  },
];

// Estimated $/month scales with how many skills the use case has -- more
// skills, more things Buildo can do, more it can earn -- capped at $4,000/mo
// (the number given for Home, which sits at the cap with 5 skills).
const PER_SKILL_MONTHLY = 800;
const MAX_MONTHLY_INCOME = 4000;

export function estimatedIncome(useCase: UseCase): number {
  return Math.min(useCase.skillSlugs.length * PER_SKILL_MONTHLY, MAX_MONTHLY_INCOME);
}

export function estimatedIncomeLabel(useCase: UseCase): string {
  return `$${estimatedIncome(useCase).toLocaleString()}/month`;
}

export function getUseCase(key: string | undefined): UseCase | undefined {
  return USE_CASES.find((u) => u.key === key);
}
