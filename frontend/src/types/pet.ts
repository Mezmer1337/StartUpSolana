/** Legacy species label; pets hatched from eggs store their archetype here. */
export type PetType = string;
export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC";
export type Archetype = "ROUND" | "QUADRUPED" | "HUMANOID" | "BIRD" | "AQUATIC";
export type AuraType = "FIRE" | "WATER" | "EARTH" | "AIR" | "LIGHTNING" | "SHADOW" | "LIGHT" | "VOID";
export type GrowthStage = "BABY" | "YOUNG" | "ADULT" | "EVOLVED";


export const RARITIES: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];

/** 1 star for Common … 6 for Mythic — the tier is readable at a glance, even colour-blind. */
export const RARITY_STARS: Record<Rarity, number> = { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5, MYTHIC: 6 };

export const RARITY_COLOR: Record<Rarity, string> = {
  COMMON: "#9ca3af",
  UNCOMMON: "#22c55e",
  RARE: "#3b82f6",
  EPIC: "#a855f7",
  LEGENDARY: "#f59e0b",
  MYTHIC: "#ef4444",
};

export const AURA_COLOR: Record<AuraType, string> = {
  FIRE: "#f97316",
  WATER: "#38bdf8",
  EARTH: "#84cc16",
  AIR: "#e5e7eb",
  LIGHTNING: "#facc15",
  SHADOW: "#7c3aed",
  LIGHT: "#fef9c3",
  VOID: "#0f172a",
};

export const AURA_EMOJI: Record<AuraType, string> = {
  FIRE: "🔥",
  WATER: "💧",
  EARTH: "🌿",
  AIR: "💨",
  LIGHTNING: "⚡",
  SHADOW: "🌑",
  LIGHT: "✨",
  VOID: "🌌",
};

export const GROWTH_STAGE_LABEL: Record<GrowthStage, string> = {
  BABY: "Baby",
  YOUNG: "Young",
  ADULT: "Adult",
  EVOLVED: "Evolved",
};

export function growthStageForLevel(level: number): GrowthStage {
  if (level < 5) return "BABY";
  if (level < 15) return "YOUNG";
  if (level < 30) return "ADULT";
  return "EVOLVED";
}

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

export interface PetPalette {
  baseHue: number;
  harmony: string;
  primary: string;
  secondary: string;
  patternColor: string;
  accent: string;
  outline: string;
}

export interface Pet {
  id: string;
  ownerWallet: string;
  name: string;
  type: PetType;
  color: string;
  rarity: Rarity;

  seedHash: string;
  dnaHash: string;
  archetype: Archetype;
  traits: string; // JSON-encoded PetTraits — parse with JSON.parse
  bodyParams: string; // JSON-encoded {width,height,size,headSize}
  palette: string; // JSON-encoded PetPalette (gameplay DNA; the drawn colours come from `look`)
  look: string | null; // JSON-encoded shared/petArt PetLook — the hand-drawn parts actually shown
  traitScore: number;
  auraType: AuraType | null;
  generation: number;
  equippedAccessoryKey: string | null;

  level: number;
  xp: number;
  health: number;
  hunger: number;
  happiness: number;
  energy: number;
  strength: number;
  speed: number;
  luck: number;
  nftMintAddress: string | null;
  metadataUri: string | null;
  mintStatus: "UNMINTED" | "MINTED";
  lastFedAt: string | null;
  lastPlayedAt: string | null;
  lastRestedAt: string | null;
  lastTrainedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PetActionResult {
  pet: Pet;
  leveledUp: boolean;
  newLevel?: number;
}
