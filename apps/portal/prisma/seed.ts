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
    name: "Pour coffee into a mug",
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
    category: "INVENTORY",
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
    category: "HOME",
    reward: 5,
    instructions:
      "Set up one potted plant and a small watering container filled with water. Start the recording, pick up " +
      "the container, pour steadily into the soil until the container is empty, and set it back down.",
  },
  {
    slug: "greet-and-handoff",
    name: "Greet and hand off an item",
    summary: "Approach a person, greet them, and hand over a small object.",
    category: "PUBLIC",
    reward: 8,
    instructions:
      "With a second person standing a few steps away and a small object (a box, a bag) in hand, start the " +
      "recording, walk up to them, say a short greeting, and hand the object to them so they take hold of it " +
      "before you release.",
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
