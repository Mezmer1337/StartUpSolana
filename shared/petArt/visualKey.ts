import type { PetLook } from "./types";
import { hueOf } from "./color";

/**
 * A canonical description of what a pet LOOKS like, quantised to steps a
 * human can tell apart. The backend stores a hash of it in the UNIQUE
 * Pet.visualKey column and re-rolls the egg on collision, so "every pet
 * looks different" is enforced by the database, not just made unlikely.
 *
 * Palette hues are bucketed into 24 steps (15°) plus a saturation band;
 * iris hue into 12 steps (30°) per eye.
 */
export function computeVisualKey(look: PetLook, auraType: string | null): string {
  const iris = (colors: string[]) => `i${Math.floor(hueOf(colors[0]) / 30)}`;
  const parts = Object.keys(look.parts)
    .sort()
    .map((k) => `${k}=${look.parts[k] ?? "-"}`)
    .join(",");
  const palette = `${look.palette.tier}:${look.palette.hues.map((h) => Math.floor(h / 15)).join(".")}:s${look.palette.sat}`;
  return [
    look.set,
    parts,
    palette,
    look.eyes.hetero ? "H" : "M",
    iris(look.eyes.right),
    look.eyes.hetero ? iris(look.eyes.left) : "",
    auraType ?? "-",
  ].join("|");
}
