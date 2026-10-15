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
  // Estimated $/month this app earns its creator. Warehouse and hospital
  // apps run near-constantly in those settings, so they sit at the top of
  // the $200-$400 range; the rest sit near the bottom.
  monthlyIncome: number;
}

export const USE_CASES: UseCase[] = [
  {
    key: "HOME",
    title: "Home",
    description: "Train Buildo to work in your home",
    skillSlugs: ["wash-dish", "pour-coffee", "load-washing-machine", "fold-towel", "wipe-counter"],
    monthlyIncome: 200,
  },
  {
    key: "SHOP",
    title: "Shops",
    description: "Train Buildo to assist in retail shops",
    skillSlugs: ["greet-and-handoff", "sort-pantry-items", "scan-and-bag-item", "restock-shelf"],
    monthlyIncome: 200,
  },
  {
    key: "OFFICE",
    title: "Offices",
    description: "Train Buildo to help around the office",
    skillSlugs: ["water-plant", "deliver-mail-to-desk", "tidy-meeting-room", "restock-supply-cabinet"],
    monthlyIncome: 250,
  },
  {
    key: "WAREHOUSE",
    title: "Warehouses",
    description: "Train Buildo for warehouse logistics",
    skillSlugs: ["scan-and-palletize-box", "pick-item-for-order", "label-and-seal-package", "load-truck-dock"],
    monthlyIncome: 400,
  },
  {
    key: "HOSPITAL",
    title: "Hospitals",
    description: "Train Buildo to support hospital staff",
    skillSlugs: ["deliver-meal-tray", "restock-supply-cart", "sanitize-surface", "fetch-and-deliver-item"],
    monthlyIncome: 400,
  },
];

export function estimatedIncome(useCase: UseCase): number {
  return useCase.monthlyIncome;
}

export function getUseCase(key: string | undefined): UseCase | undefined {
  return USE_CASES.find((u) => u.key === key);
}
