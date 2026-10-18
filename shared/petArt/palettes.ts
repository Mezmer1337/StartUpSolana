import type { PaletteTier, PetLook, PetLookV1, PetPalette } from "./types";
import { hsl, mix } from "./color";
import { lerp } from "./random";

// ------------------------------------------------------------ tier odds ---
/**
 * Palette tier odds by the pet's DNA rarity. Common palettes (one hue) are
 * the norm; two-hue palettes are rare, three-hue ones legendary — and a
 * rarer pet is likelier to roll a fancier palette. Overall across the
 * rarity distribution: ~86% common, ~12% rare, ~2% legendary.
 */
export const PALETTE_TIER_ODDS: Record<string, { rare: number; legendary: number }> = {
  COMMON: { rare: 0.08, legendary: 0.01 },
  UNCOMMON: { rare: 0.12, legendary: 0.02 },
  RARE: { rare: 0.25, legendary: 0.04 },
  EPIC: { rare: 0.35, legendary: 0.08 },
  LEGENDARY: { rare: 0.4, legendary: 0.25 },
  MYTHIC: { rare: 0.3, legendary: 0.6 },
};

export function rollPaletteTier(rarity: string, r: () => number): PaletteTier {
  const odds = PALETTE_TIER_ODDS[rarity] ?? PALETTE_TIER_ODDS.COMMON;
  const roll = r();
  if (roll < odds.legendary) return "legendary";
  if (roll < odds.legendary + odds.rare) return "rare";
  return "common";
}

// ---------------------------------------------------------------- names ---
const HUE_NAMES: [number, string][] = [
  [0, "Crimson"], [15, "Scarlet"], [30, "Ember"], [45, "Amber"], [60, "Gold"], [75, "Lime"],
  [95, "Moss"], [125, "Jade"], [150, "Mint"], [170, "Teal"], [190, "Aqua"], [205, "Sky"],
  [220, "Azure"], [240, "Sapphire"], [258, "Indigo"], [275, "Violet"], [295, "Orchid"],
  [315, "Magenta"], [330, "Rose"], [345, "Ruby"], [360, "Crimson"],
];
export function hueName(h: number): string {
  let best = HUE_NAMES[0];
  for (const entry of HUE_NAMES) if (Math.abs(entry[0] - h) < Math.abs(best[0] - h)) best = entry;
  return best[1];
}
const SAT_WORD = ["Dusty", "", "Vivid"];

// ------------------------------------------------------------ generator ---
/** One shade of a hue at ramp position t (0 light … 1 dark). */
function shade(hue: number, sat: number, t: number, lightTop: number, lightBottom: number): string {
  // Light shades are a touch less saturated, dark ones a touch more — reads as one material.
  const s = Math.min(95, sat * lerp(0.75, 1.1, t));
  return hsl((hue + 360) % 360, s, lerp(lightTop, lightBottom, t));
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Picks a hue at least `minGap` degrees from every hue already chosen. */
function distinctHue(r: () => number, taken: number[], minGap = 55): number {
  for (let i = 0; i < 20; i++) {
    const h = r() * 360;
    if (taken.every((t) => hueGap(t, h) >= minGap)) return h;
  }
  return (taken[taken.length - 1] + 120) % 360;
}

export function generatePalette(tier: PaletteTier, r: () => number): PetPalette {
  const satBand = Math.floor(r() * 3); // muted / normal / vivid
  const sat = [lerp(30, 45, r()), lerp(50, 68, r()), lerp(72, 90, r())][satBand];
  const lightTop = lerp(86, 94, r());
  const lightBottom = lerp(20, 32, r());
  const ts = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1];

  if (tier === "common") {
    // One hue; a small drift (±6°) along the ramp keeps it from looking flat.
    const hue = r() * 360;
    const drift = lerp(-6, 6, r());
    return {
      tier,
      name: [SAT_WORD[satBand], hueName(hue)].filter(Boolean).join(" "),
      hues: [Math.round(hue)],
      sat: satBand,
      stops: ts.map((t) => [t, shade(hue + drift * t, sat, t, lightTop, lightBottom)]),
    };
  }

  if (tier === "rare") {
    // Two hues: the light half (belly, muzzle, horns) from one, the dark half (fur) from the other.
    const dark = r() * 360;
    const light = distinctHue(r, [dark]);
    return {
      tier,
      name: `${hueName(dark)} & ${hueName(light)}`,
      hues: [Math.round(dark), Math.round(light)],
      sat: satBand,
      stops: ts.map((t) => [t, t <= 0.5 ? shade(light, sat, t, lightTop, lightBottom) : shade(dark, sat, t, lightTop, lightBottom)]),
    };
  }

  // Legendary: three hues — light / mid / dark thirds, blended at the seams.
  const dark = r() * 360;
  const mid = distinctHue(r, [dark]);
  const light = distinctHue(r, [dark, mid]);
  const vivid = Math.max(sat, 70);
  const hueAt = (t: number) => (t < 0.34 ? light : t < 0.67 ? mid : dark);
  return {
    tier,
    name: `${hueName(dark)} · ${hueName(mid)} · ${hueName(light)}`,
    hues: [Math.round(dark), Math.round(mid), Math.round(light)],
    sat: 2,
    stops: ts.map((t) => [t, shade(hueAt(t), vivid, t, lightTop, lightBottom)]),
  };
}

/** Colour of a palette ramp at position t (linear blend between stops). */
export function sampleRamp(stops: [number, string][], t: number): string {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      return mix(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

// --------------------------------------------- legacy (v1) named palettes ---
/** Named palettes used by v1 looks. Kept only so those pets render exactly as hatched. */
const LEGACY_PALETTES: Record<string, { name: string; colors: string[] }> = {
  sunset: { name: "Sunset", colors: ["#f3e79b", "#fac484", "#f8a07e", "#eb7f86", "#ce6693", "#a059a0", "#5c53a5"] },
  ocean: { name: "Ocean", colors: ["#e0f7f4", "#a8e6cf", "#6fd1c5", "#3fb0c9", "#2c84b8", "#2a5d9f", "#263a7a"] },
  forest: { name: "Forest", colors: ["#f1f5c6", "#cde59a", "#9fcf7a", "#6fb26a", "#4a8f5e", "#2f6b4f", "#1d4a3d"] },
  ember: { name: "Ember", colors: ["#fff1c1", "#ffd36e", "#ffa94d", "#f9733e", "#d94a38", "#a32c3a", "#6b1f3a"] },
  lavender: { name: "Lavender", colors: ["#fbf3ff", "#ead7ff", "#d4b8f5", "#b896e8", "#9a72d6", "#7b54bd", "#573a94"] },
  candy: { name: "Candy", colors: ["#fff0f5", "#ffd1e3", "#ffadc9", "#ff85ad", "#f25f92", "#c94477", "#8f2e5c"] },
  mint: { name: "Mint Choc", colors: ["#f4fff0", "#c9f2d0", "#98e0b4", "#6cc49d", "#4c9a80", "#3f6e5e", "#3a4a40"] },
  arctic: { name: "Arctic", colors: ["#ffffff", "#e3eef8", "#c4d7ea", "#9db8d6", "#7895be", "#5a74a1", "#3f5480"] },
  autumn: { name: "Autumn", colors: ["#fdf0d5", "#f6d38b", "#eaa95b", "#d17e3c", "#a85a2f", "#7a3f2a", "#4e2a22"] },
  midnight: { name: "Midnight", colors: ["#e6e9ff", "#b9c0f5", "#8d95e4", "#6a6fcf", "#4d4fb0", "#37358a", "#241f5c"] },
};
/** Importer lightness positions (t) of the 7 original source colours #f3e79b … #5c53a5 (fixed by RAMP_LIGHT/RAMP_DARK). */
const V1_SOURCE_T = [0, 0.1644, 0.3343, 0.5011, 0.669, 0.8324, 1];

/** Converts a v1 look so the original 7 colours render exactly as before. */
export function upgradeLook(look: PetLook | PetLookV1): PetLook {
  if (look.v === 2) return look;
  const legacy = LEGACY_PALETTES[look.palette] ?? LEGACY_PALETTES.sunset;
  const stops = V1_SOURCE_T.map((t, i): [number, string] => [t, legacy.colors[look.perm[i] ?? i]]);
  return {
    v: 2,
    set: look.set,
    parts: look.parts,
    palette: { tier: "common", name: legacy.name, hues: [], sat: 1, stops },
    eyes: look.eyes,
  };
}
