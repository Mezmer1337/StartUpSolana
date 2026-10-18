import type { ArtSet, PetLook } from "./types";
import { generatePalette, rollPaletteTier } from "./palettes";
import { getArtSet, DEFAULT_ART_SET } from "./sets";
import { SPECIAL_SLOTS } from "./aura";
import { hsl } from "./color";
import { lerp, rngFromString } from "./random";

/**
 * Optional slots ("small chance to appear"), by rarity tier. A rarer pet
 * (rarity comes from the gameplay DNA) is more likely to roll horns/tail,
 * so prestige shows on the creature. Every other slot always gets a part.
 * Overall rate across the rarity distribution is ~10-12%.
 */
export const OPTIONAL_SLOT_CHANCE: Record<string, Record<string, number>> = {
  horns: { COMMON: 0.08, UNCOMMON: 0.12, RARE: 0.2, EPIC: 0.3, LEGENDARY: 0.45, MYTHIC: 0.6 },
  tail: { COMMON: 0.08, UNCOMMON: 0.12, RARE: 0.2, EPIC: 0.3, LEGENDARY: 0.45, MYTHIC: 0.6 },
};

/** Chance that the two eyes get different iris colours. */
export const HETEROCHROMIA_CHANCE = 0.5;

/** One fully random iris gradient (independent of the body palette). */
function randomIris(r: () => number, stops: number): string[] {
  const hue = r() * 360;
  const sat = lerp(55, 95, r());
  const light = lerp(30, 52, r());
  const hueShift = lerp(10, 45, r()) * (r() < 0.5 ? -1 : 1);
  const lightGain = lerp(14, 30, r());
  return Array.from({ length: stops }, (_, i) => {
    const t = stops === 1 ? 0 : i / (stops - 1);
    return hsl((hue + hueShift * t + 360) % 360, sat, Math.min(85, light + lightGain * t));
  });
}

/**
 * Rolls a pet's look from its seed. Called ONCE at hatch time; the result is
 * stored in Pet.look. Deterministic, so re-rolling the same seed gives the
 * same pet — as long as the art file hasn't changed since.
 */
export function rollLook(seedHash: string, rarity: string, set: ArtSet = getArtSet(DEFAULT_ART_SET)): PetLook {
  const r = rngFromString(`look:${set.id}:${seedHash}`);

  const parts: PetLook["parts"] = {};
  for (const slot of set.slots) {
    if (SPECIAL_SLOTS.has(slot.key)) continue; // e.g. the aura: drawn from DNA's auraType, not rolled
    const chance = OPTIONAL_SLOT_CHANCE[slot.key]?.[rarity] ?? OPTIONAL_SLOT_CHANCE[slot.key]?.COMMON;
    const roll = r();
    const pick = slot.variants[Math.floor(r() * slot.variants.length)];
    parts[slot.key] = chance !== undefined && roll >= chance ? null : pick.id;
  }

  const palette = generatePalette(rollPaletteTier(rarity, r), r);

  const hetero = r() < HETEROCHROMIA_CHANCE;
  const right = randomIris(r, set.irisStops);
  const left = hetero ? randomIris(r, set.irisStops) : right;

  return { v: 2, set: set.id, parts, palette, eyes: { hetero, left, right } };
}
