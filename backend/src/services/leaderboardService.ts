import { prisma } from "../db";

/** Ranks pets by level (tie-broken by XP) across all owners. */
export async function getLeaderboard(limit = 50) {
  const pets = await prisma.pet.findMany({
    orderBy: [{ level: "desc" }, { xp: "desc" }],
    take: limit,
  });

  return pets.map((pet, index) => ({
    rank: index + 1,
    wallet: pet.ownerWallet,
    petId: pet.id,
    petName: pet.name,
    petType: pet.archetype,
    // Fields the shared renderer needs to draw the pet's portrait.
    art: {
      seedHash: pet.seedHash,
      rarity: pet.rarity,
      look: pet.look,
      auraType: pet.auraType,
      level: pet.level,
    },
    rarity: pet.rarity,
    level: pet.level,
    xp: pet.xp,
  }));
}
