import { mix } from "./color";

/**
 * Colour schemes for the artist's AURA layer — one per elemental aura the
 * DNA can roll (backend/src/constants/dna.ts AURA_WEIGHTS). The layer's
 * gradient stops are replaced inner → outer by these colours; FIRE is the
 * artist's original yellow → orange.
 */
export const AURA_SCHEMES: Record<string, { name: string; colors: string[]; spark: string }> = {
  FIRE: { name: "Fire", colors: ["#ffe70b", "#ff9f0b"], spark: "#ffd166" },
  WATER: { name: "Water", colors: ["#a5f3ff", "#1e7fd8"], spark: "#7dd3fc" },
  EARTH: { name: "Earth", colors: ["#e6ff8a", "#3f8f2a"], spark: "#bef264" },
  AIR: { name: "Air", colors: ["#ffffff", "#9cc9f0"], spark: "#e0f2fe" },
  LIGHTNING: { name: "Lightning", colors: ["#fff59d", "#8b5cf6"], spark: "#fde047" },
  SHADOW: { name: "Shadow", colors: ["#b794ff", "#2a124d"], spark: "#a78bfa" },
  LIGHT: { name: "Light", colors: ["#ffffff", "#ffc94d"], spark: "#fef9c3" },
  VOID: { name: "Void", colors: ["#ff7ae0", "#160a35"], spark: "#f0abfc" },
};

/** Token values {{aura0}}… for an aura type, resampled to the layer's stop count. */
export function auraTokens(auraType: string, stops: number): Record<string, string> {
  const { colors } = AURA_SCHEMES[auraType] ?? AURA_SCHEMES.FIRE;
  const out: Record<string, string> = {};
  for (let i = 0; i < stops; i++) {
    const t = stops === 1 ? 0 : (i / (stops - 1)) * (colors.length - 1);
    const lo = Math.floor(t);
    out[`aura${i}`] = mix(colors[lo], colors[Math.min(colors.length - 1, lo + 1)], t - lo);
  }
  return out;
}

/** Slots drawn by special rules, never rolled as a normal part. */
export const SPECIAL_SLOTS = new Set(["aura"]);
