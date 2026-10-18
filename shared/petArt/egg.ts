import { lerp, rngFromString } from "./random";

export type EggCrack = 0 | 1 | 2 | 3;

const EGG_PATH = "M256 92 C338 92 392 222 392 316 C392 398 332 452 256 452 C180 452 120 398 120 316 C120 222 174 92 256 92 Z";

/**
 * Mystery egg. Deliberately reveals nothing about the pet inside — every
 * egg uses the same palette; only the speckle layout varies by `seed`
 * (any string, e.g. a purchase id), so eggs aren't pixel-identical.
 * `crack` 0..3 is used by the hatching animation.
 */
export function renderEggSvg(seed = "egg", crack: EggCrack = 0): string {
  const r = rngFromString(`egg:${seed}`);
  const speckles = Array.from({ length: 16 }, () => {
    const x = lerp(150, 362, r());
    const y = lerp(140, 430, r());
    const rr = lerp(6, 18, r());
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rr.toFixed(1)}" ry="${(rr * 0.8).toFixed(1)}" fill="${r() < 0.5 ? "#a78bfa" : "#22d3ee"}" opacity="0.75"/>`;
  }).join("");

  const cracks = [
    "",
    "M236 170 L250 196 L238 214",
    "M200 236 L226 222 L240 248 L262 226 L276 250 L300 232 M236 170 L250 196 L238 214",
    "M128 290 L162 270 L186 300 L214 268 L240 302 L268 266 L294 300 L322 268 L350 298 L386 280 M236 170 L250 196 L238 214 L246 232",
  ][crack];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="egg-clip"><path d="${EGG_PATH}"/></clipPath>
    <radialGradient id="egg-fill" cx="40%" cy="32%" r="75%">
      <stop offset="0" stop-color="#fffaf0"/><stop offset="0.6" stop-color="#f5e6cf"/><stop offset="1" stop-color="#d9bfa0"/>
    </radialGradient>
    <radialGradient id="egg-glow"><stop offset="0.5" stop-color="#a78bfa" stop-opacity="0.45"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="256" cy="290" r="230" fill="url(#egg-glow)"/>
  <ellipse cx="256" cy="462" rx="120" ry="16" fill="#000000" opacity="0.2"/>
  <path d="${EGG_PATH}" fill="url(#egg-fill)"/>
  <g clip-path="url(#egg-clip)">${speckles}
    <path d="M150 330 Q256 360 362 330 L362 352 Q256 384 150 352 Z" fill="#8b5cf6" opacity="0.55"/>
  </g>
  <path d="${EGG_PATH}" fill="none" stroke="#4c3a6b" stroke-width="7" stroke-linejoin="round"/>
  ${cracks ? `<path d="${cracks}" fill="none" stroke="#2b1d40" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  <ellipse cx="208" cy="170" rx="22" ry="34" fill="#ffffff" opacity="0.55" transform="rotate(-20 208 170)"/>
</svg>`;
}
