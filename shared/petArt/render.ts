import type { ArtGrowthStage, ArtSlot, ArtVariant, PetArtInput, PetArtRecord, PetLook, PetLookV1, PetMood } from "./types";
import { getArtSet } from "./sets";
import { sampleRamp, upgradeLook } from "./palettes";
import { rollLook } from "./look";
import { mix } from "./color";
import { lerp, rngFromString } from "./random";
import { DEFAULT_ROLES, animationCss, halfClipDefs, sleepZs, wrapRoles } from "./animation";
import { AURA_SCHEMES, SPECIAL_SLOTS, auraTokens } from "./aura";

/** Whole-creature scale per growth stage, anchored at the bottom centre. */
const STAGE_SCALE: Record<ArtGrowthStage, number> = { BABY: 0.72, YOUNG: 0.82, ADULT: 0.92, EVOLVED: 0.98 };

export function stageForLevel(level: number): ArtGrowthStage {
  if (level < 5) return "BABY";
  if (level < 15) return "YOUNG";
  if (level < 30) return "ADULT";
  return "EVOLVED";
}

/** Stored look (upgraded to the current format), or — for pets without one — re-rolled from the seed. */
export function lookFromRecord(pet: PetArtRecord): PetLook {
  if (pet.look) {
    try {
      return upgradeLook(JSON.parse(pet.look) as PetLook | PetLookV1);
    } catch {
      /* fall through to a deterministic re-roll */
    }
  }
  return rollLook(pet.seedHash, pet.rarity);
}

export function artInputFromRecord(pet: PetArtRecord): PetArtInput {
  return { look: lookFromRecord(pet), auraType: pet.auraType, stage: stageForLevel(pet.level) };
}

/**
 * Finds the stored variant even after the artist reorganised the file:
 * exact id first; else the variant that contains all the stored element ids
 * (e.g. "path73+path73-2" after both paths were grouped into "g1"); else the
 * layer's first variant (the stored one was deleted).
 */
export function resolveVariant(slot: ArtSlot, id: string | null | undefined): ArtVariant {
  if (id) {
    const exact = slot.variants.find((v) => v.id === id);
    if (exact) return exact;
    const wanted = id.split("+");
    const moved = slot.variants.find((v) => wanted.every((w) => v.contains.includes(w)));
    if (moved) return moved;
  }
  return slot.variants[0];
}

export interface RenderOptions {
  /** Paint a full background card (NFT image). The in-game viewer leaves it transparent. */
  background?: boolean;
  /** Animation mood; default "none" (static — what the NFT image uses). */
  mood?: PetMood;
}

export function renderPetSvg(input: PetArtInput, opts: RenderOptions = {}): string {
  const { look } = input;
  const mood = opts.mood ?? "none";
  const set = getArtSet(look.set);
  const W = set.width;
  const H = set.height;

  const tokens: Record<string, string> = {};
  set.sourceColors.forEach((c, i) => (tokens[`c${i}`] = sampleRamp(look.palette.stops, c.t)));
  look.eyes.left.forEach((c, i) => (tokens[`irisL${i}`] = c));
  look.eyes.right.forEach((c, i) => (tokens[`irisR${i}`] = c));
  // Always resolve the aura tokens: its gradient lives in <defs> even when the layer isn't drawn.
  if (set.auraStops) Object.assign(tokens, auraTokens(input.auraType ?? "FIRE", set.auraStops));
  const hasAuraArt = set.slots.some((s) => s.key === "aura");

  const body = set.slots
    .map((slot) => {
      if (slot.key === "aura") {
        if (!input.auraType) return ""; // the aura layer only shows on pets that rolled one
      } else if (SPECIAL_SLOTS.has(slot.key) || look.parts[slot.key] === null) {
        return ""; // optional slot that didn't roll
      }
      const variant = resolveVariant(slot, look.parts[slot.key]);
      const placed = slot.transform ? `<g transform="${slot.transform}">${variant.svg}</g>` : variant.svg;
      return mood === "none" ? placed : wrapRoles(placed, slot.anim ?? DEFAULT_ROLES[slot.key] ?? [], mood);
    })
    .join("");

  const s = STAGE_SCALE[input.stage];
  const stageTransform = `translate(${((W / 2) * (1 - s)).toFixed(2)} ${(H * (1 - s) * 0.97).toFixed(2)}) scale(${s})`;
  const animSeed = `${Object.values(look.parts).join()}|${look.eyes.right.join()}`;

  // Sparkles in the aura's colour; the soft round glow is only a fallback for art sets without an AURA layer.
  const aura = input.auraType ? (AURA_SCHEMES[input.auraType] ?? AURA_SCHEMES.FIRE).spark : null;
  const particles = aura
    ? (() => {
        const r = rngFromString(`aura:${animSeed}`);
        return Array.from({ length: 14 }, () => {
          const a = r() * Math.PI * 2;
          const d = lerp(170, 240, r());
          return `<circle cx="${(W / 2 + Math.cos(a) * d).toFixed(1)}" cy="${(H / 2 + Math.sin(a) * d).toFixed(1)}" r="${lerp(2.5, 7, r()).toFixed(1)}" fill="${aura}" opacity="${lerp(0.4, 0.9, r()).toFixed(2)}"/>`;
        }).join("");
      })()
    : "";

  const light = sampleRamp(look.palette.stops, 0);
  const soft = sampleRamp(look.palette.stops, 0.25);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>${set.defs}${mood === "run" ? halfClipDefs(set.pivots) : ""}
    <radialGradient id="pet-bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${mix(light, "#ffffff", 0.55)}"/><stop offset="1" stop-color="${mix(soft, "#ffffff", 0.35)}"/></radialGradient>
    ${aura ? `<radialGradient id="pet-aura"><stop offset="0.35" stop-color="${aura}" stop-opacity="0.6"/><stop offset="1" stop-color="${aura}" stop-opacity="0"/></radialGradient>` : ""}
  </defs>
  ${animationCss(mood, set.pivots, animSeed)}
  ${opts.background ? `<rect width="${W}" height="${H}" rx="48" fill="url(#pet-bg)"/>` : ""}
  ${aura ? `${hasAuraArt ? "" : `<circle cx="${W / 2}" cy="${H / 2}" r="${W / 2}" fill="url(#pet-aura)"/>`}${particles}` : ""}
  <g transform="${stageTransform}"><g class="a-root">${body}</g>${mood === "sleep" ? sleepZs(set.pivots) : ""}</g>
</svg>`;

  return svg.replace(/\{\{(\w+)\}\}/g, (m, key: string) => tokens[key] ?? m);
}

export function renderPetSvgFromRecord(pet: PetArtRecord, opts?: RenderOptions): string {
  return renderPetSvg(artInputFromRecord(pet), opts);
}

const TIER_LABEL = { common: "Common", rare: "Rare", legendary: "Legendary" } as const;

/** Human-readable traits for NFT metadata: one attribute per slot + palette + eyes. */
export function describeLook(look: PetLook): { trait_type: string; value: string }[] {
  const set = getArtSet(look.set);
  const attrs = set.slots
    .filter((slot) => !SPECIAL_SLOTS.has(slot.key) && (slot.variants.length > 1 || look.parts[slot.key] === null))
    .map((slot) => {
      const id = look.parts[slot.key];
      if (id === null) return { trait_type: cap(slot.key), value: "None" };
      const v = resolveVariant(slot, id);
      return { trait_type: cap(slot.key), value: v.label ?? `#${slot.variants.indexOf(v) + 1}` };
    });
  attrs.push({ trait_type: "Palette", value: look.palette.name });
  attrs.push({ trait_type: "Palette Tier", value: TIER_LABEL[look.palette.tier] });
  attrs.push({ trait_type: "Eye Colors", value: look.eyes.hetero ? "Heterochromia" : "Matching" });
  return attrs;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
