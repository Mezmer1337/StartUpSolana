// Rarity lives in constants/dna.ts (6-tier, driven by Trait Score). Pets
// are no longer chosen by species: the player buys an egg and the hatched
// creature's archetype (body plan) comes from its DNA. This file keeps the
// per-archetype starting stats and the leveling/cooldown math.

import type { Archetype } from "./dna";

// Base stat starting points per archetype — small flavour differences so
// the body plan you hatch is not purely cosmetic.
export const ARCHETYPE_BASE_STATS: Record<Archetype, { strength: number; speed: number; luck: number }> = {
  ROUND: { strength: 9, speed: 9, luck: 14 },
  QUADRUPED: { strength: 12, speed: 13, luck: 8 },
  HUMANOID: { strength: 14, speed: 9, luck: 10 },
  BIRD: { strength: 8, speed: 15, luck: 11 },
  AQUATIC: { strength: 10, speed: 12, luck: 12 },
};

export const MAX_PET_NAME_LENGTH = 32;

const NAME_START = ["Bo", "Ki", "Mo", "Pi", "Lu", "Zu", "Ra", "No", "Fi", "Ta", "Su", "Vi", "Do", "Ye"];
const NAME_END = ["bo", "ki", "mi", "ra", "lo", "zz", "py", "nu", "to", "xi", "ly", "rk", "sh", "mo"];

/** Default name for a freshly hatched pet, derived from its seedHash. */
export function defaultPetName(seedHash: string): string {
  const n = (i: number) => parseInt(seedHash.slice(i, i + 2), 16);
  return NAME_START[n(0) % NAME_START.length] + NAME_END[n(2) % NAME_END.length] + (n(4) % 2 ? NAME_END[n(6) % NAME_END.length] : "");
}

/**
 * XP required to REACH a given level (level 1 = 0 XP).
 * Levels 1-5 follow the fixed curve from the game design doc; levels 6+
 * extend it with a smooth, ever-increasing step so the curve keeps scaling
 * without needing a hand-authored table forever.
 */
const FIXED_THRESHOLDS = [0, 100, 250, 500, 850];

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level <= FIXED_THRESHOLDS.length) return FIXED_THRESHOLDS[level - 1];

  let xp = FIXED_THRESHOLDS[FIXED_THRESHOLDS.length - 1];
  let step = 350; // matches the level 4->5 gap (850-500=350) as the starting step
  for (let lvl = FIXED_THRESHOLDS.length + 1; lvl <= level; lvl++) {
    xp += step;
    step += 150;
  }
  return xp;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export const MAX_STAT = 100;

export const COOLDOWNS_MS = {
  FEED: 60 * 60 * 1000, // 1 hour
  PLAY: 30 * 60 * 1000, // 30 minutes
  REST: 45 * 60 * 1000, // 45 minutes
  TRAIN: 2 * 60 * 60 * 1000, // 2 hours
};
