import type { ArtSet } from "./types";
import { ART_SET_ZVERI } from "./generated/zveri";

/** All compiled art sets. A new Inkscape file = `npm run art:import -- <file> <id>` + one line here. */
const ART_SETS: Record<string, ArtSet> = {
  [ART_SET_ZVERI.id]: ART_SET_ZVERI,
};

export const DEFAULT_ART_SET = ART_SET_ZVERI.id;

export function getArtSet(id: string): ArtSet {
  return ART_SETS[id] ?? ART_SETS[DEFAULT_ART_SET];
}
