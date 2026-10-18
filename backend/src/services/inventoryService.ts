import { Pet } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";
import { getOrCreateUser } from "./userService";
import { applyXpAndSave, assertOwnership, getPetById } from "./petService";
import { computeVisualKeyHash } from "./dnaService";
import { MAX_STAT } from "../constants/petData";
import { AURA_TYPES } from "../constants/dna";
import { getArtSet, lookFromRecord, resolveVariant } from "../../../shared/petArt";
import type { PetLook } from "../../../shared/petArt";

const clamp = (value: number, min = 0, max = MAX_STAT) => Math.max(min, Math.min(max, value));

export async function getInventory(ownerWallet: string) {
  return prisma.inventoryItem.findMany({
    where: { ownerWallet, quantity: { gt: 0 } },
    include: { item: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function grantItem(ownerWallet: string, itemKey: string, quantity = 1) {
  await getOrCreateUser(ownerWallet);
  const item = await prisma.item.findUnique({ where: { key: itemKey } });
  if (!item) throw new ApiError(404, `Unknown item "${itemKey}"`);

  return prisma.inventoryItem.upsert({
    where: { ownerWallet_itemId: { ownerWallet, itemId: item.id } },
    update: { quantity: { increment: quantity } },
    create: { ownerWallet, itemId: item.id, quantity },
    include: { item: true },
  });
}

const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

async function visualKeyTaken(visualKey: string, petId: string) {
  return !!(await prisma.pet.findFirst({ where: { visualKey, NOT: { id: petId } }, select: { id: true } }));
}

/**
 * Mystic items: give the pet a random variant of an optional part (horns /
 * tail) — a different one if it already has it. The new look must still be
 * unique among all pets (visualKey), so candidates are tried in random order.
 */
async function growPart(pet: Pet, slotKey: "horns" | "tail") {
  const look = lookFromRecord(pet);
  const slot = getArtSet(look.set).slots.find((sl) => sl.key === slotKey);
  if (!slot) throw new ApiError(400, `This art set has no ${slotKey}`);
  const current = look.parts[slotKey] ? resolveVariant(slot, look.parts[slotKey]).id : null;
  for (const v of shuffle(slot.variants.filter((v) => v.id !== current))) {
    const next: PetLook = { ...look, parts: { ...look.parts, [slotKey]: v.id } };
    const visualKey = computeVisualKeyHash(next, pet.auraType);
    if (await visualKeyTaken(visualKey, pet.id)) continue;
    const updated = await prisma.pet.update({ where: { id: pet.id }, data: { look: JSON.stringify(next), visualKey } });
    const n = slot.variants.indexOf(v) + 1;
    return { pet: updated, effect: `${pet.name} grew ${slotKey === "horns" ? "horns" : "a tail"}${v.label ? ` (${v.label})` : ` #${n}`}!` };
  }
  throw new ApiError(409, `No new ${slotKey} left that keeps ${pet.name} one-of-a-kind`);
}

async function awakenAura(pet: Pet) {
  const look = lookFromRecord(pet);
  for (const aura of shuffle(AURA_TYPES.filter((a) => a !== pet.auraType))) {
    const visualKey = computeVisualKeyHash(look, aura);
    if (await visualKeyTaken(visualKey, pet.id)) continue;
    // Persist the look too, so legacy pets (look = null) keep exactly this look from now on.
    const updated = await prisma.pet.update({ where: { id: pet.id }, data: { auraType: aura, look: JSON.stringify(look), visualKey } });
    return { pet: updated, effect: `${pet.name} awakened a ${aura} aura!` };
  }
  throw new ApiError(409, "No new aura left that keeps this pet one-of-a-kind");
}

/**
 * Applies an item's effect to a pet, then decrements the stack by one (only
 * after the effect succeeded, so a refused mystic item isn't lost).
 * Returns the updated pet plus a human-readable `effect`.
 */
export async function useItem(ownerWallet: string, petId: string, itemKey: string) {
  const pet = await getPetById(petId);
  assertOwnership(pet, ownerWallet);

  const item = await prisma.item.findUnique({ where: { key: itemKey } });
  if (!item) throw new ApiError(404, `Unknown item "${itemKey}"`);

  const inventoryEntry = await prisma.inventoryItem.findUnique({
    where: { ownerWallet_itemId: { ownerWallet, itemId: item.id } },
  });
  if (!inventoryEntry || inventoryEntry.quantity < 1) {
    throw new ApiError(400, "You do not have this item");
  }

  let result: { pet: Pet; effect: string };
  const stat = async (data: Partial<Pet>, effect: string) => ({ pet: await prisma.pet.update({ where: { id: petId }, data }), effect });
  switch (item.key) {
    case "kibble":
      result = await stat({ hunger: clamp(pet.hunger + 15) }, `${pet.name} ate: +15 Hunger`);
      break;
    case "premium_meal": {
      const r = await applyXpAndSave(pet, { hunger: clamp(pet.hunger + 40) }, 15);
      result = { pet: r.pet, effect: `${pet.name} feasted: +40 Hunger, +15 XP${r.leveledUp ? ` — Level ${r.newLevel}!` : ""}` };
      break;
    }
    case "chew_toy":
      result = await stat({ happiness: clamp(pet.happiness + 20) }, `${pet.name} is happier: +20 Happiness`);
      break;
    case "energy_potion":
      result = await stat({ energy: clamp(pet.energy + 30) }, `${pet.name} feels energized: +30 Energy`);
      break;
    case "health_potion":
      result = await stat({ health: clamp(pet.health + 25) }, `${pet.name} healed: +25 Health`);
      break;
    case "training_weights":
      result = await stat({ strength: pet.strength + 2 }, `${pet.name}: +2 Strength`);
      break;
    case "speed_boots":
      result = await stat({ speed: pet.speed + 2 }, `${pet.name}: +2 Speed`);
      break;
    case "lucky_clover":
      result = await stat({ luck: pet.luck + 2 }, `${pet.name}: +2 Luck`);
      break;
    case "mega_protein":
      result = await stat({ strength: pet.strength + 5, energy: clamp(pet.energy + 20) }, `${pet.name}: +5 Strength, +20 Energy`);
      break;
    case "xp_scroll": {
      const r = await applyXpAndSave(pet, {}, 50);
      result = { pet: r.pet, effect: `${pet.name}: +50 XP${r.leveledUp ? ` — reached Level ${r.newLevel}!` : ""}` };
      break;
    }
    case "horn_elixir":
      result = await growPart(pet, "horns");
      break;
    case "tail_charm":
      result = await growPart(pet, "tail");
      break;
    case "aura_crystal":
      result = await awakenAura(pet);
      break;
    default:
      throw new ApiError(400, item.category === "COSMETIC" ? "Cosmetics are equipped on the pet's page, not used" : `Item "${item.key}" has no defined effect`);
  }

  await prisma.inventoryItem.update({ where: { id: inventoryEntry.id }, data: { quantity: { decrement: 1 } } });
  return { ...result.pet, effect: result.effect };
}
