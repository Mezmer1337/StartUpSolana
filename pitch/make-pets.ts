// Renders the pet images used on the pitch cards (run from backend/: npx tsx ../pitch/make-pets.ts).
import { writeFileSync } from "fs";
import { resolve } from "path";
import { generatePalette, renderPetSvg, rngFromString, rollLook } from "../shared/petArt";
import type { PaletteTier, PetLook } from "../shared/petArt";

const out = resolve(__dirname, "assets/pets");
const rarities = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
const auras = [null, null, null, "FIRE", null, "WATER", null, null, "VOID", null, null, "LIGHT"];

// 12 unique pets for the grids, with a mix of palette tiers and a few auras.
for (let i = 0; i < 12; i++) {
  const base = rollLook(`pitch-${i * 7 + 3}`, rarities[i % 6]);
  const tier: PaletteTier = i % 5 === 0 ? "legendary" : i % 3 === 0 ? "rare" : "common";
  const look: PetLook = { ...base, palette: generatePalette(tier, rngFromString(`pitch-pal-${i}`)) };
  writeFileSync(`${out}/unique-${i}.svg`, renderPetSvg({ look, auraType: auras[i], stage: "ADULT" }, { background: true }));
}
// Team avatars: Legendary pets with a two-colour (rare-tier) palette in a chosen
// hue pair. Seeds are searched until the generated palette lands near the pair.
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const TEAM: { file: string; dark: number; light: number; seed: string }[] = [
  { file: "team-ayan", dark: 350, light: 48, seed: "ayan" }, // crimson & gold
  { file: "team-0", dark: 268, light: 45, seed: "bexultan" }, // indigo & amber
  { file: "team-aibek", dark: 140, light: 22, seed: "aibek" }, // emerald & peach
  { file: "team-1", dark: 178, light: 12, seed: "arina" }, // teal & coral
  { file: "team-miras", dark: 305, light: 165, seed: "miras" }, // magenta & mint
];
for (const m of TEAM) {
  let palette = generatePalette("rare", rngFromString(m.seed));
  for (let i = 0; i < 20000; i++) {
    const p = generatePalette("rare", rngFromString(`${m.seed}-${i}`));
    if (p.sat === 2 && hueGap(p.hues[0], m.dark) < 8 && hueGap(p.hues[1], m.light) < 8) {
      palette = p;
      break;
    }
  }
  const base = rollLook(`team-${m.seed}`, "LEGENDARY");
  const parts = { ...base.parts };
  // Legendary flair: horns and a tail (first variant of each that the art set has).
  if ("horns" in parts) parts.horns = parts.horns ?? "g7";
  if ("tail" in parts) parts.tail = parts.tail ?? "path8";
  const look: PetLook = { ...base, parts, palette };
  writeFileSync(`${out}/${m.file}.svg`, renderPetSvg({ look, auraType: null, stage: "ADULT" }));
  console.log(`${m.file}: ${palette.name}`);
}

// The "clone": one plain pet, reused 18× on the problem card.
writeFileSync(`${out}/clone.svg`, renderPetSvg({ look: rollLook("pitch-clone", "COMMON"), auraType: null, stage: "ADULT" }));
console.log("pet images written to", out);
