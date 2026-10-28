// Seeds the predefined skill catalog shown in the mobile app's Record tab.
// Safe to re-run -- every skill is upserted by its stable `slug`.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SKILLS = [
  {
    slug: "wash-dish",
    name: "Wash a plate",
    summary: "Rinse, scrub, and rack a single dinner plate at a sink.",
    category: "KITCHEN",
    reward: 5,
    instructions:
      "Wear your capture gloves and glasses. Stand at a kitchen sink with one dirty plate and a sponge. " +
      "Start the recording, then: pick up the plate, rinse both sides under running water, scrub with the " +
      "sponge for 5-10 seconds per side, rinse again, and place it upright in a dish rack. Stop the recording " +
      "once the plate is racked.",
  },
  {
    slug: "pour-coffee",
    name: "Prepare a coffee",
    summary: "Pour brewed coffee from a pot or kettle into a mug without spilling.",
    category: "KITCHEN",
    reward: 5,
    instructions:
      "Set up a pot or kettle with liquid (coffee, or water as a stand-in) and an empty mug on a counter. Start " +
      "the recording, pick up the pot, pour steadily into the mug until it's about three-quarters full, then " +
      "set the pot back down. Keep both hands visible throughout the pour.",
  },
  {
    slug: "load-washing-machine",
    name: "Load the washing machine",
    summary: "Load a small pile of clothes into a washing machine and start it.",
    category: "CLEANING",
    reward: 8,
    instructions:
      "Set out a small pile of 4-6 clothing items next to a washing machine with its door open. Start the " +
      "recording, load the items in one at a time, close the door, and press start. Stop the recording once " +
      "the machine is running.",
  },
  {
    slug: "fold-towel",
    name: "Fold a hand towel",
    summary: "Fold a hand towel into a neat rectangle and stack it.",
    category: "HOME",
    reward: 5,
    instructions:
      "Lay one hand towel flat on a table. Start the recording, fold it in half lengthwise, then in half again " +
      "widthwise, and place it on top of an existing stack. Keep both hands visible to the glasses camera " +
      "throughout the fold.",
  },
  {
    slug: "wipe-counter",
    name: "Wipe a counter",
    summary: "Clear a counter surface with a cloth in overlapping strokes.",
    category: "CLEANING",
    reward: 5,
    instructions:
      "Pick a clear stretch of counter at least 60cm wide with a few light crumbs or a water ring on it. Start " +
      "the recording, pick up a cloth, and wipe the surface in overlapping side-to-side strokes until it's " +
      "visibly clean, then set the cloth down.",
  },
  {
    slug: "sort-pantry-items",
    name: "Sort pantry items",
    summary: "Group 5+ small pantry items by type into separate bins.",
    category: "SHOP",
    reward: 6,
    instructions:
      "Set out at least 5 small pantry items (cans, boxes, jars) mixed together, plus 2-3 empty bins or trays. " +
      "Start the recording and sort each item into a bin by type one at a time, narrating out loud what group " +
      "each item belongs to.",
  },
  {
    slug: "water-plant",
    name: "Water a houseplant",
    summary: "Pour a measured amount of water into a potted plant.",
    category: "OFFICE",
    reward: 5,
    instructions:
      "Set up one potted plant and a small watering container filled with water. Start the recording, pick up " +
      "the container, pour steadily into the soil until the container is empty, and set it back down.",
  },
  {
    slug: "greet-and-handoff",
    name: "Greet and hand off an item",
    summary: "Approach a person, greet them, and hand over a small object.",
    category: "SHOP",
    reward: 8,
    instructions:
      "With a second person standing a few steps away and a small object (a box, a bag) in hand, start the " +
      "recording, walk up to them, say a short greeting, and hand the object to them so they take hold of it " +
      "before you release.",
  },
  // Shop
  {
    slug: "scan-and-bag-item",
    name: "Scan and bag an item",
    summary: "Scan a product's barcode and place it into a bag.",
    category: "SHOP",
    reward: 5,
    instructions:
      "Set out one product with a visible barcode and an open bag on a counter. Start the recording, pick up " +
      "the item, show its barcode to the scanner, then place the item into the bag. Stop the recording once " +
      "it's bagged.",
  },
  {
    slug: "restock-shelf",
    name: "Restock a shelf",
    summary: "Move a small stack of boxed items from a cart onto a shelf.",
    category: "SHOP",
    reward: 6,
    instructions:
      "Set out 4-6 boxed items on a cart next to an empty shelf section. Start the recording, move each item " +
      "from the cart to the shelf one at a time, lining them up neatly, and stop once the shelf is stocked.",
  },
  // Office
  {
    slug: "deliver-mail-to-desk",
    name: "Deliver mail to desk",
    summary: "Carry an envelope or package from a mail tray to a desk.",
    category: "OFFICE",
    reward: 5,
    instructions:
      "Set out one envelope or small package on a mail tray, and a desk a few steps away. Start the recording, " +
      "pick up the item, walk it to the desk, and place it down in a visible spot. Stop the recording once it's " +
      "placed.",
  },
  {
    slug: "tidy-meeting-room",
    name: "Tidy a meeting room",
    summary: "Clear cups and straighten chairs in a meeting room after use.",
    category: "OFFICE",
    reward: 6,
    instructions:
      "Set up a table with 2-3 used cups or papers and a couple of pushed-out chairs. Start the recording, " +
      "clear the cups/papers onto a tray, and push each chair back in. Stop the recording once the room looks " +
      "tidy.",
  },
  {
    slug: "restock-supply-cabinet",
    name: "Restock the supply cabinet",
    summary: "Refill a supply cabinet with a few boxed items.",
    category: "OFFICE",
    reward: 6,
    instructions:
      "Set out 3-5 small supply boxes (paper, pens, etc.) and an open cabinet with some empty shelf space. " +
      "Start the recording, place each box onto a shelf, and stop once the cabinet is restocked.",
  },
  // Warehouse
  {
    slug: "scan-and-palletize-box",
    name: "Scan and palletize a box",
    summary: "Scan a box's label and stack it onto a pallet.",
    category: "WAREHOUSE",
    reward: 7,
    instructions:
      "Set out one labeled box and an empty pallet nearby. Start the recording, pick up the box, show its " +
      "label to the scanner, and place it onto the pallet. Stop the recording once it's stacked.",
  },
  {
    slug: "pick-item-for-order",
    name: "Pick an item for an order",
    summary: "Pick a specific item off a shelf for an order and place it in a tote.",
    category: "WAREHOUSE",
    reward: 6,
    instructions:
      "Set out a shelf with a few different items and an empty tote nearby. Start the recording, find and pick " +
      "up the correct item, place it into the tote, and stop the recording once it's placed.",
  },
  {
    slug: "label-and-seal-package",
    name: "Label and seal a package",
    summary: "Apply a shipping label to a box and seal it with tape.",
    category: "WAREHOUSE",
    reward: 6,
    instructions:
      "Set out one closed box, a shipping label, and tape. Start the recording, apply the label to the top of " +
      "the box, then seal the remaining edges with tape. Stop the recording once it's sealed.",
  },
  {
    slug: "load-truck-dock",
    name: "Load a package at the dock",
    summary: "Carry a package from the dock floor onto a truck or trolley.",
    category: "WAREHOUSE",
    reward: 8,
    instructions:
      "Set out one package on the floor near a loading dock and a trolley or truck bed a few steps away. Start " +
      "the recording, pick up the package, carry it over, and load it on. Stop the recording once it's loaded.",
  },
  // Hospital
  {
    slug: "deliver-meal-tray",
    name: "Deliver a meal tray",
    summary: "Carry a meal tray from a cart to a patient's bedside table.",
    category: "HOSPITAL",
    reward: 6,
    instructions:
      "Set out one tray with a plate/cup on a cart, and a bedside table a few steps away. Start the recording, " +
      "pick up the tray carefully, carry it over, and set it down on the table. Stop the recording once it's " +
      "placed.",
  },
  {
    slug: "restock-supply-cart",
    name: "Restock a supply cart",
    summary: "Refill a cart with a few small medical supply items.",
    category: "HOSPITAL",
    reward: 6,
    instructions:
      "Set out 3-5 small supply items (a glove box, wipes, etc.) and a cart with some empty space. Start the " +
      "recording, place each item onto the cart, and stop once it's restocked.",
  },
  {
    slug: "sanitize-surface",
    name: "Sanitize a surface",
    summary: "Wipe down a surface or handrail with a sanitizing cloth.",
    category: "HOSPITAL",
    reward: 5,
    instructions:
      "Pick a clear surface or handrail about 60cm long. Start the recording, pick up a sanitizing wipe, and " +
      "wipe the surface in overlapping strokes until it's fully covered. Stop the recording once done.",
  },
  {
    slug: "fetch-and-deliver-item",
    name: "Fetch and deliver an item",
    summary: "Fetch a requested item and deliver it to a nurse station.",
    category: "HOSPITAL",
    reward: 6,
    instructions:
      "Set out one item at a storage point and a nurse station a few steps away. Start the recording, pick up " +
      "the item, walk it to the station, and hand it off or set it down. Stop the recording once delivered.",
  },
];

async function main() {
  for (const skill of SKILLS) {
    await prisma.skillDefinition.upsert({
      where: { slug: skill.slug },
      update: skill,
      create: skill,
    });
  }
  console.log(`Seeded ${SKILLS.length} skill definitions.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
