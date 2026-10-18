import { createHash, randomBytes } from "crypto";
import { prisma } from "../db";
import {
  ARCHETYPE_OPTIONS,
  ARCHETYPE_SOCKETS,
  AURA_NONE_WEIGHT,
  AURA_TOTAL_WEIGHT,
  AURA_WEIGHTS,
  Archetype,
  AuraType,
  COLOR_HARMONIES,
  EARS,
  EYES,
  FINS,
  LEGS,
  MOUTHS,
  PATTERNS,
  RarityKey,
  SPECIALS,
  TAILS,
  WINGS,
  WeightedOption,
  rarityFromScore,
} from "../constants/dna";
import { generatePalette, Palette } from "./colorService";
import { computeVisualKey, rollLook } from "../../../shared/petArt";
import type { PetLook } from "../../../shared/petArt";

export interface PetTraits {
  ears?: string;
  eyes?: string;
  mouth?: string;
  tail?: string;
  legs?: string;
  wings?: string;
  fins?: string;
  special?: string;
  pattern: string;
}

export interface BodyParams {
  width: number;
  height: number;
  size: number;
  headSize: number;
}

export interface PetDna {
  seedHash: string;
  dnaHash: string;
  archetype: Archetype;
  traits: PetTraits;
  bodyParams: BodyParams;
  palette: Palette;
  traitScore: number;
  rarity: RarityKey;
  auraType: AuraType | null;
}

export interface UniquePetDna extends PetDna {
  /** Hand-drawn look rolled at hatch time — stored in Pet.look. */
  look: PetLook;
  /** sha256 of the quantised look — stored in the UNIQUE Pet.visualKey column. */
  visualKey: string;
}

/** sha256(seed) as a hex string — the seed itself is never persisted. */
export function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/**
 * Builds a fresh, safe generation seed. Per the brief, we NEVER touch the
 * user's real wallet private key or seed phrase — this combines the
 * wallet address (public info) with server-side randomness and a
 * timestamp, so it's unique per mint and unguessable in advance, while
 * still being fully reproducible from the resulting seedHash for audits.
 */
export function buildGenerationSeed(wallet: string, petName: string): string {
  return `${wallet}:${petName}:${Date.now()}:${randomBytes(16).toString("hex")}`;
}

/** Mulberry32 — small, fast, deterministic PRNG seeded from a 32-bit int. */
function mulberry32(seed: number) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a stream of independent-enough 32-bit seeds from one hash. */
function seedStream(hashHex: string): () => number {
  // Walk the hex digest 8 chars (32 bits) at a time, wrapping around and
  // re-hashing once exhausted, so the stream never runs dry.
  let hex = hashHex;
  let offset = 0;
  const nextSeed = () => {
    if (offset + 8 > hex.length) {
      hex = createHash("sha256").update(hex).digest("hex");
      offset = 0;
    }
    const chunk = hex.slice(offset, offset + 8);
    offset += 8;
    return parseInt(chunk, 16);
  };
  let rng = mulberry32(nextSeed());
  let drawsOnThisRng = 0;
  return () => {
    // Re-seed periodically from the hash stream for extra decorrelation.
    if (drawsOnThisRng++ > 6) {
      rng = mulberry32(nextSeed());
      drawsOnThisRng = 0;
    }
    return rng();
  };
}

function weightedPick<T extends WeightedOption>(options: T[], rand: () => number): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = rand() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option;
  }
  return options[options.length - 1];
}

function range(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

/** Pure function: same seedHash always produces the exact same DNA. */
export function deriveDnaFromSeedHash(seedHash: string): Omit<PetDna, "seedHash" | "dnaHash"> {
  const rand = seedStream(seedHash);

  const archetypeOption = weightedPick(ARCHETYPE_OPTIONS, rand);
  const archetype = archetypeOption.id as Archetype;
  const sockets = ARCHETYPE_SOCKETS[archetype];

  let score = archetypeOption.rarityPoints;
  const traits: PetTraits = { pattern: "solid" };

  const pick = (pool: WeightedOption[]) => {
    const opt = weightedPick(pool, rand);
    score += opt.rarityPoints;
    return opt.id;
  };

  if (sockets.includes("ears")) traits.ears = pick(EARS);
  if (sockets.includes("eyes")) traits.eyes = pick(EYES);
  if (sockets.includes("mouth")) traits.mouth = pick(MOUTHS);
  if (sockets.includes("tail")) traits.tail = pick(TAILS);
  if (sockets.includes("legs")) traits.legs = pick(LEGS);
  if (sockets.includes("wings")) traits.wings = pick(WINGS);
  if (sockets.includes("fins")) traits.fins = pick(FINS);
  if (sockets.includes("special")) traits.special = pick(SPECIALS);
  traits.pattern = pick(PATTERNS);

  const bodyParams: BodyParams = {
    width: Number(range(rand, 0.8, 1.2).toFixed(3)),
    height: Number(range(rand, 0.8, 1.2).toFixed(3)),
    size: Number(range(rand, 0.8, 1.2).toFixed(3)),
    headSize: Number(range(rand, 0.8, 1.2).toFixed(3)),
  };

  const baseHue = Math.floor(range(rand, 0, 360));
  const harmony = COLOR_HARMONIES[Math.floor(rand() * COLOR_HARMONIES.length)];
  const saturation = range(rand, 40, 85);
  const value = range(rand, 40, 85);
  const palette = generatePalette(baseHue, harmony, saturation, value);

  // Aura roll — an independent, very-low-probability draw (brief 20-21).
  let auraRoll = rand() * AURA_TOTAL_WEIGHT;
  let auraType: AuraType | null = null;
  auraRoll -= AURA_NONE_WEIGHT;
  if (auraRoll > 0) {
    for (const [aura, weight] of Object.entries(AURA_WEIGHTS)) {
      auraRoll -= weight;
      if (auraRoll <= 0) {
        auraType = aura as AuraType;
        break;
      }
    }
  }
  if (auraType) score += 15;

  const rarity = rarityFromScore(score, auraType !== null);

  return { archetype, traits, bodyParams, palette, traitScore: score, rarity, auraType };
}

export function computeDnaHash(seedHash: string, derived: Omit<PetDna, "seedHash" | "dnaHash">): string {
  const payload = JSON.stringify({
    archetype: derived.archetype,
    traits: derived.traits,
    bodyParams: derived.bodyParams,
    palette: derived.palette,
    auraType: derived.auraType,
    seedHash,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function computeVisualKeyHash(look: PetLook, auraType: string | null): string {
  return createHash("sha256").update(computeVisualKey(look, auraType)).digest("hex");
}

/**
 * Hatches a fresh egg: generates a full, deterministic pet DNA and re-rolls
 * with a fresh seed until the result is unique on BOTH axes:
 *  - dnaHash   — the exact DNA (the brief: a 256-bit hash alone isn't a
 *                *proof* of uniqueness, so we check the DB)
 *  - visualKey — what the pet LOOKS like, quantised to visible steps, so
 *                no two pets are lookalikes even if their raw DNA differs.
 * With ~10^9 distinguishable looks (parts × palettes × iris colours) a re-roll is rare; MAX_ATTEMPTS only
 * guards against a pathological catalog misconfiguration.
 */
export async function generateUniquePetDna(wallet: string, petName: string): Promise<UniquePetDna> {
  const MAX_ATTEMPTS = 20;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = buildGenerationSeed(wallet, petName);
    const seedHash = hashSeed(seed);
    const derived = deriveDnaFromSeedHash(seedHash);
    const dnaHash = computeDnaHash(seedHash, derived);
    // Rarer pets are likelier to roll the optional parts (horns, tail).
    const look = rollLook(seedHash, derived.rarity);
    const visualKey = computeVisualKeyHash(look, derived.auraType);

    const existing = await prisma.pet.findFirst({ where: { OR: [{ dnaHash }, { visualKey }] }, select: { id: true } });
    if (!existing) {
      return { seedHash, dnaHash, look, visualKey, ...derived };
    }
  }
  throw new Error("Failed to hatch a visually unique pet after multiple attempts");
}
