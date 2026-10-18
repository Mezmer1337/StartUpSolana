// Motion for pets, as CSS animations embedded in the SVG itself — so they
// play everywhere the SVG is shown as an <img> (cards, profile, games)
// with zero JS. The NFT image is rendered with mood "none" (static).
//
// Each slot is wrapped in groups by "role"; every role animates around a
// pivot point from the art set (the "_pivots" layer in Inkscape). A layer
// can declare its roles in its name, e.g. "Очки [glasses] @head @blink";
// otherwise DEFAULT_ROLES below applies, and an unknown layer simply moves
// with the whole body.

import type { ArtPivots, PetMood } from "./types";
import { lerp, rngFromString } from "./random";

export const ANIM_ROLES = ["head", "ears", "hair", "blink", "tail", "arms", "stride", "aura"] as const;
export type AnimRole = (typeof ANIM_ROLES)[number];

export const DEFAULT_ROLES: Record<string, AnimRole[]> = {
  ears: ["head", "ears"],
  head: ["head"],
  muzzle: ["head"],
  eyes: ["head", "blink"],
  iris: ["head", "blink"],
  highlight: ["head", "blink"],
  eyelids: ["head", "blink"],
  nose: ["head"],
  mouth: ["head"],
  hair: ["head", "hair"],
  horns: ["head"],
  tail: ["tail"],
  arms: ["arms"],
  legs: ["stride"],
  feet: ["stride"],
  aura: ["aura"],
};

/**
 * Wraps slot markup in one <g> per role (outer → inner). While running,
 * paired limbs (@stride legs/feet, @arms) are drawn twice — clipped to the
 * left and right half of the canvas — so each side can swing on its own
 * even though the artist drew both legs in one group.
 */
export function wrapRoles(svg: string, roles: string[], mood: PetMood): string {
  const split = (cls: string, inner: string) =>
    `<g clip-path="url(#half-L)"><g class="a-${cls}L">${inner}</g></g><g clip-path="url(#half-R)"><g class="a-${cls}R">${inner}</g></g>`;
  return roles.reduceRight((inner, role) => {
    if (mood === "run" && role === "stride") return split("stride", inner);
    if (mood === "run" && role === "arms") return `<g class="a-arms">${split("arm", inner)}</g>`;
    return `<g class="a-${role}">${inner}</g>`;
  }, svg);
}

/** Clip paths for the left/right limb split (canvas centre = the hips pivot x). */
export function halfClipDefs(p: ArtPivots): string {
  const cx = p.hips[0];
  return `<clipPath id="half-L"><rect x="-2000" y="-2000" width="${2000 + cx}" height="5000"/></clipPath><clipPath id="half-R"><rect x="${cx}" y="-2000" width="4000" height="5000"/></clipPath>`;
}

const px = ([x, y]: [number, number]) => `${x}px ${y}px`;

/**
 * Stylesheet for one pet. Speed and phase vary per pet (from `seed`), so a
 * room full of pets never bobs in lockstep — each has its own "temperament".
 */
export function animationCss(mood: PetMood, p: ArtPivots, seed: string): string {
  if (mood === "none") return "";
  const r = rngFromString(`anim:${seed}`);
  const k = lerp(0.85, 1.2, r()); // tempo
  const d = (base: number) => `${(base * k).toFixed(2)}s`;
  const delay = `-${(r() * 3).toFixed(2)}s`;

  const box = (cls: string, pivot: [number, number], anim: string) =>
    `.${cls}{transform-box:view-box;transform-origin:${px(pivot)};animation:${anim};animation-delay:${delay}}`;

  const shared = `
    @keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
    @keyframes wiggle{0%,78%,100%{transform:rotate(0)}82%{transform:rotate(4deg)}86%{transform:rotate(-4deg)}90%{transform:rotate(2deg)}}
    @keyframes hairbounce{0%,100%{transform:rotate(0)}50%{transform:rotate(-3deg)}}
    @keyframes wag{0%{transform:rotate(-7deg)}100%{transform:rotate(9deg)}}
    @keyframes armbob{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}
    @keyframes flicker{0%,100%{transform:scale(1,1) skewX(0);opacity:.95}25%{transform:scale(1.02,1.05) skewX(1.5deg);opacity:1}50%{transform:scale(.99,1.02) skewX(-1deg);opacity:.85}75%{transform:scale(1.03,1.06) skewX(-1.8deg);opacity:1}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

  const aura = box("a-aura", p.ground, `flicker ${d(1.6)} ease-in-out infinite`);

  if (mood === "run") {
    // One stride cycle = two steps; the body bounces on each step and waddles side to side.
    const T = d(0.52);
    return `<style>${shared}${aura}
      @keyframes waddle{0%,100%{transform:translateY(0) rotate(-2.5deg)}25%{transform:translateY(-14px) rotate(0)}50%{transform:translateY(0) rotate(2.5deg)}75%{transform:translateY(-14px) rotate(0)}}
      @keyframes strideL{0%,50%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-18px) rotate(-7deg)}}
      @keyframes strideR{0%,50%,100%{transform:translateY(0) rotate(0)}75%{transform:translateY(-18px) rotate(7deg)}}
      @keyframes armL{0%,100%{transform:rotate(12deg)}50%{transform:rotate(-12deg)}}
      @keyframes armR{0%,100%{transform:rotate(12deg)}50%{transform:rotate(-12deg)}}
      @keyframes headbob{0%,50%,100%{transform:rotate(0)}25%{transform:rotate(2deg)}75%{transform:rotate(-2deg)}}
      ${box("a-root", p.ground, `waddle ${T} linear infinite`)}
      ${box("a-strideL", p.hips, `strideL ${T} ease-in-out infinite`)}
      ${box("a-strideR", p.hips, `strideR ${T} ease-in-out infinite`)}
      ${box("a-armL", p.body, `armL ${T} ease-in-out infinite`)}
      ${box("a-armR", p.body, `armR ${T} ease-in-out infinite reverse`)}
      ${box("a-head", p.neck, `headbob ${T} ease-in-out infinite`)}
      ${box("a-ears", p.head, `wiggle ${d(0.6)} ease-in-out infinite`)}
      ${box("a-hair", p.head, `hairbounce ${d(0.26)} ease-in-out infinite`)}
      ${box("a-tail", p.tail, `wag ${d(0.2)} ease-in-out infinite alternate`)}
    </style>`;
  }

  if (mood === "happy") {
    return `<style>${shared}${aura}
      @keyframes hop{0%,100%{transform:translateY(0) scale(1,1)}25%{transform:translateY(-28px) scale(.97,1.04)}50%{transform:translateY(0) scale(1.05,.95)}}
      @keyframes cheer{0%,100%{transform:translateY(0)}25%{transform:translateY(-10px)}}
      ${box("a-root", p.ground, `hop ${d(0.7)} ease-in-out infinite`)}
      ${box("a-head", p.neck, `sway ${d(0.7)} ease-in-out infinite`)}
      ${box("a-ears", p.head, `wiggle ${d(0.9)} ease-in-out infinite`)}
      ${box("a-hair", p.head, `hairbounce ${d(0.35)} ease-in-out infinite`)}
      ${box("a-tail", p.tail, `wag ${d(0.22)} ease-in-out infinite alternate`)}
      ${box("a-arms", p.body, `cheer ${d(0.7)} ease-in-out infinite`)}
    </style>`;
  }

  if (mood === "sleep") {
    return `<style>${shared}${aura}
      @keyframes snore{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.975)}}
      @keyframes zzz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(26px,-60px);opacity:0}}
      ${box("a-root", p.ground, `snore ${d(4.5)} ease-in-out infinite`)}
      .a-head{transform-box:view-box;transform-origin:${px(p.neck)};transform:rotate(5deg)}
      .a-blink{transform-box:view-box;transform-origin:${px(p.eyes)};transform:scaleY(.08)}
      ${box("a-tail", p.tail, `wag ${d(4)} ease-in-out infinite alternate`)}
      .zz{animation:zzz 3s linear infinite}.zz2{animation-delay:-1s}.zz3{animation-delay:-2s}
    </style>`;
  }

  // idle
  return `<style>${shared}${aura}
    @keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,.985)}}
    @keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
    ${box("a-root", p.ground, `breathe ${d(3.2)} ease-in-out infinite`)}
    ${box("a-head", p.neck, `sway ${d(4.6)} ease-in-out infinite`)}
    ${box("a-ears", p.head, `wiggle ${d(5.5)} ease-in-out infinite`)}
    ${box("a-hair", p.head, `hairbounce ${d(2.3)} ease-in-out infinite`)}
    ${box("a-blink", p.eyes, `blink ${d(4.2)} linear infinite`)}
    ${box("a-tail", p.tail, `wag ${d(1.4)} ease-in-out infinite alternate`)}
    ${box("a-arms", p.body, `armbob ${d(3.2)} ease-in-out infinite`)}
  </style>`;
}

/** Floating "z z z" for the sleep mood, near the head's top-right. */
export function sleepZs(p: ArtPivots): string {
  const [x, y] = [p.head[0] + 110, p.head[1] - 110];
  return [0, 1, 2]
    .map(
      (i) =>
        `<text class="zz zz${i + 1}" x="${x + i * 4}" y="${y}" font-family="Arial, sans-serif" font-weight="bold" font-size="${30 + i * 6}" fill="#ffffff" stroke="#5b4a8a" stroke-width="3" paint-order="stroke">z</text>`,
    )
    .join("");
}
