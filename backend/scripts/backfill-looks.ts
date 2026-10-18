// Stores a look + visualKey for pets hatched before looks were persisted
// (their look is otherwise re-rolled from the seed on every render, which
// would shift whenever the art file gains new variants).
//   npm run art:backfill
import { prisma } from "../src/db";
import { computeVisualKeyHash } from "../src/services/dnaService";
import { rollLook } from "../../shared/petArt";

(async () => {
  const pets = await prisma.pet.findMany({ where: { look: null } });
  for (const pet of pets) {
    const look = rollLook(pet.seedHash, pet.rarity);
    const visualKey = computeVisualKeyHash(look, pet.auraType);
    const clash = await prisma.pet.findFirst({ where: { visualKey }, select: { id: true } });
    await prisma.pet.update({
      where: { id: pet.id },
      // A legacy lookalike keeps visualKey null rather than failing the backfill.
      data: { look: JSON.stringify(look), visualKey: clash ? null : visualKey },
    });
    console.log(`${pet.name} (${pet.id}): look stored${clash ? " — LOOKALIKE of " + clash.id + ", visualKey left empty" : ""}`);
  }
  console.log(`Backfilled ${pets.length} pet(s).`);
})().finally(() => prisma.$disconnect());
