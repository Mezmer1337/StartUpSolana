// Shared pet-art types. This folder is imported by BOTH backend (NFT image,
// hatch-time look roll, visualKey uniqueness) and frontend (in-game viewer),
// so the picture a player sees and the NFT image are always identical.
// Keep it dependency-free: no node:crypto, no DOM, no React.

export type ArtGrowthStage = "BABY" | "YOUNG" | "ADULT" | "EVOLVED";

/** One selectable variant inside a layer of the artist's Inkscape file. */
export interface ArtVariant {
  /** Stable id = Inkscape object id(s), e.g. "g68" or "path73+path73-2". */
  id: string;
  /** Inkscape label of the object, if the artist named it — shown as the NFT trait value. */
  label: string | null;
  /**
   * Every element id inside the variant. Lets a stored id survive the
   * artist regrouping objects: "path73+path73-2" still resolves after both
   * paths were grouped into "g1".
   */
  contains: string[];
  /** SVG markup with colour tokens: {{c0}}..{{cN}} palette, {{irisL0}}… iris. */
  svg: string;
}

/** One Inkscape layer = one slot; the renderer draws exactly one variant (or none if optional). */
export interface ArtSlot {
  key: string;
  /** Layer name in the source file (e.g. "Уши"). */
  label: string;
  /** Accumulated transform of the layer and its parent layers. */
  transform: string;
  /** Animation roles from the layer name ("@head @blink"); absent = defaults by key. */
  anim?: string[];
  variants: ArtVariant[];
}

/** Animation pivot points in canvas coordinates (from the "_pivots" layer or defaults). */
export interface ArtPivots {
  ground: [number, number];
  neck: [number, number];
  head: [number, number];
  eyes: [number, number];
  tail: [number, number];
  body: [number, number];
  /** Hip line centre — the legs/feet swing around it in the run animation. */
  hips: [number, number];
}

/** A whole hand-drawn set, compiled from an Inkscape file by backend/scripts/import-art.ts. */
export interface ArtSet {
  id: string;
  source: string;
  width: number;
  height: number;
  /** <defs> content (gradients), tokenised like the variants. */
  defs: string;
  /**
   * The artist's palette colours. Token {{cI}} = sourceColors[I]; `t` is its
   * lightness position (0 = as light as the reference light colour, 1 = as
   * dark as the reference dark one) — the pet's palette is sampled at `t`.
   */
  sourceColors: { hex: string; t: number }[];
  /** Number of colour stops per iris gradient (tokens {{irisL0}}…, {{irisR0}}…). */
  irisStops: number;
  /** Colour stops of the aura layer's gradient (tokens {{aura0}}…); 0 = no AURA layer in the file. */
  auraStops: number;
  pivots: ArtPivots;
  /** Slots in draw order (bottom → top). */
  slots: ArtSlot[];
}

export type PaletteTier = "common" | "rare" | "legendary";

/**
 * A pet's body palette: a light → dark colour ramp. Common = shades of one
 * hue, rare = two hues, legendary = three hues. Stored fully resolved in
 * the look, so retuning the generator never recolours existing pets.
 */
export interface PetPalette {
  tier: PaletteTier;
  name: string;
  /** Hues the ramp is built from (1/2/3) — used for naming and uniqueness. */
  hues: number[];
  /** Saturation band 0..2 (muted/normal/vivid) — used for uniqueness. */
  sat: number;
  /** [t, hex] ramp stops, t = 0 lightest … 1 darkest. */
  stops: [number, string][];
}

/**
 * Everything that decides how a pet looks. Rolled ONCE at hatch time
 * (rollLook) and stored in Pet.look, so adding new variants or colours to
 * the art file later never changes pets that already exist.
 */
export interface PetLook {
  v: 2;
  set: string;
  /** slot key -> variant id, or null when an optional slot (horns/tail) didn't roll. */
  parts: Record<string, string | null>;
  palette: PetPalette;
  eyes: { hetero: boolean; left: string[]; right: string[] };
}

/** Looks stored before procedural palettes (named palette + index permutation). */
export interface PetLookV1 {
  v: 1;
  set: string;
  parts: Record<string, string | null>;
  palette: string;
  perm: number[];
  eyes: { hetero: boolean; left: string[]; right: string[] };
}

/** idle = in-game default; happy = after feeding/a good score; sleep = resting; run = games; none = static (NFT). */
export type PetMood = "idle" | "happy" | "sleep" | "run" | "none";

export interface PetArtInput {
  look: PetLook;
  auraType: string | null;
  stage: ArtGrowthStage;
}

/** The subset of a Pet row (backend Prisma or frontend API type) the art needs. */
export interface PetArtRecord {
  seedHash: string;
  rarity: string;
  /** JSON PetLook (v1 or v2); null for pets hatched before looks were stored. */
  look: string | null;
  auraType: string | null;
  level: number;
}
