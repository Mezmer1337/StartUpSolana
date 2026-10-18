export type * from "./types";
export {
  renderPetSvg,
  renderPetSvgFromRecord,
  artInputFromRecord,
  lookFromRecord,
  resolveVariant,
  stageForLevel,
  describeLook,
} from "./render";
export type { RenderOptions } from "./render";
export { rollLook, OPTIONAL_SLOT_CHANCE, HETEROCHROMIA_CHANCE } from "./look";
export { PALETTE_TIER_ODDS, generatePalette, sampleRamp, upgradeLook } from "./palettes";
export { DEFAULT_ROLES, ANIM_ROLES } from "./animation";
export { AURA_SCHEMES } from "./aura";
export { getArtSet, DEFAULT_ART_SET } from "./sets";
export { renderEggSvg } from "./egg";
export type { EggCrack } from "./egg";
export { computeVisualKey } from "./visualKey";
export { rngFromString } from "./random";

/** SVG markup -> data URI for <img src>, keeping each SVG's ids isolated. */
export const svgToDataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
