// Compiles the artist's Inkscape file into shared/petArt/generated/<set>.ts.
//
//   npm run art:import                                   # art/zveri.svg -> generated/zveri.ts
//   npm run art:import -- "C:/Users/Asus/Desktop/Звери.svg"   # copy into art/ + import
//   npm run art:watch  -- "C:/Users/Asus/Desktop/Звери.svg"   # same, on every save in Inkscape
//
// File conventions (full guide: docs/art-guide.md):
//  * every Inkscape LAYER is a slot, drawn bottom → top. Name it
//    "Человеческое имя [key]" (e.g. "Уши [ears]") — the [key] is what pets
//    store; a layer without [key] falls back to the SLOT_KEYS table below;
//  * layers whose name starts with "_" are service layers and never drawn;
//    "_pivots" holds animation pivot points (circles labelled neck/eyes/…);
//  * inside a layer the VISIBLE objects form one variant, every HIDDEN
//    object/group is a separate variant — group hidden pairs (Ctrl+G);
//  * every colour except black/white/iris is the artist's palette and is
//    recoloured per pet BY LIGHTNESS (see RAMP_LIGHT/RAMP_DARK);
//  * the iris layer gets fully random colours per eye.
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "fs";
import { basename, resolve } from "path";
import type { ArtPivots, ArtSet, ArtSlot, ArtVariant } from "../../shared/petArt/types";
import { ANIM_ROLES } from "../../shared/petArt/animation";

const projectArt = (setId: string) => resolve(__dirname, `../../art/${setId}.svg`);

/** Fallback for layers without a [key] in their name. */
const SLOT_KEYS: Record<string, string> = {
  хвост: "tail",
  ножки: "legs",
  лапки: "feet",
  тело: "body",
  животик: "belly",
  ручки: "arms",
  уши: "ears",
  голова: "head",
  мордочка: "muzzle",
  глаза: "eyes",
  радужка: "iris",
  блик: "highlight",
  веки: "eyelids",
  нос: "nose",
  рот: "mouth",
  прическа: "hair",
  причёска: "hair",
  рога: "horns",
  аура: "aura",
  aura: "aura",
};
const IRIS_SLOT = "iris";
/**
 * Slots whose colours are NOT the body palette: their gradients get their
 * own tokens. Iris -> {{irisL0}}… / {{irisR0}}… (random per eye);
 * aura -> {{aura0}}… (per aura element, see shared/petArt/aura.ts).
 */
const OWN_COLOR_SLOTS = new Set([IRIS_SLOT, "aura"]);

/**
 * Lightness anchors of the artist's palette: a colour as light as RAMP_LIGHT
 * takes the lightest colour of the pet's palette, as dark as RAMP_DARK the
 * darkest. Fixed constants (not "lightest colour in the file"), so adding
 * new colours to the file never shifts how existing colours map.
 */
const RAMP_LIGHT = "#f3e79b";
const RAMP_DARK = "#5c53a5";

/** Animation pivots for this art set (canvas coords). Overridden by the "_pivots" layer. */
const DEFAULT_PIVOTS: ArtPivots = {
  ground: [252, 490],
  neck: [252, 330],
  head: [252, 201],
  eyes: [254, 191],
  tail: [212, 398],
  body: [251, 336],
  hips: [252, 405],
};

const INK = "http://www.inkscape.org/namespaces/inkscape";

type El = Element;
const elementChildren = (n: Node): El[] =>
  Array.from(n.childNodes as unknown as ArrayLike<Node>).filter((c): c is El => c.nodeType === 1);
const isLayer = (e: El) => e.tagName === "g" && e.getAttributeNS(INK, "groupmode") === "layer";
const label = (e: El) => e.getAttributeNS(INK, "label") || null;
const isHidden = (e: El) => /display\s*:\s*none/.test(e.getAttribute("style") ?? "") || e.getAttribute("display") === "none";
const descendantIds = (e: El): string[] => {
  const out: string[] = [];
  const walk = (n: El) => {
    const id = n.getAttribute("id");
    if (id) out.push(id);
    elementChildren(n).forEach(walk);
  };
  walk(e);
  return out;
};
const hexes = (s: string) => Array.from(s.matchAll(/#[0-9a-fA-F]{6}\b/g), (m) => m[0].toLowerCase());
const urlRefs = (s: string) => Array.from(s.matchAll(/url\(#([^)]+)\)/g), (m) => m[1]);
/** Trim Inkscape's 8-digit floats to 3 decimals (~40% smaller, sub-pixel exact at 512px). */
const roundNumbers = (s: string) => s.replace(/(-?\d+\.\d{4,})/g, (m) => String(Number(Number(m).toFixed(3))));

/** CIE L* (perceptual lightness 0..100). */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
const rampT = (hex: string) => {
  const t = (lightness(RAMP_LIGHT) - lightness(hex)) / (lightness(RAMP_LIGHT) - lightness(RAMP_DARK));
  return Number(Math.min(1, Math.max(0, t)).toFixed(4));
};

export function importArt(src: string, setId = "zveri"): { set: ArtSet; report: string } {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(readFileSync(src, "utf8"), "image/svg+xml");
  const root = doc.documentElement as unknown as El;
  const width = parseFloat(root.getAttribute("width") ?? "512");
  const height = parseFloat(root.getAttribute("height") ?? "512");
  const serializer = new XMLSerializer();
  const xmlOf = (e: El) => serializer.serializeToString(e).replace(/ xmlns(:\w+)?="[^"]*"/g, "");

  // -------------------------------------------------------------- defs ----
  const defsEl = elementChildren(root).find((e) => e.tagName === "defs");
  const gradients = new Map<string, El>();
  for (const g of defsEl ? elementChildren(defsEl) : []) {
    if (/Gradient$/.test(g.tagName)) gradients.set(g.getAttribute("id")!, g);
  }
  const hrefOf = (g: El) => (g.getAttribute("xlink:href") ?? g.getAttribute("href") ?? "").replace(/^#/, "");
  const stopsHolder = (id: string): El | null => {
    let g = gradients.get(id);
    for (let i = 0; g && i < 10; i++) {
      if (elementChildren(g).some((c) => c.tagName === "stop")) return g;
      g = gradients.get(hrefOf(g));
    }
    return null;
  };

  // ----------------------------------------------------- walk the layers --
  interface RawSlot {
    key: string;
    label: string;
    anim?: string[];
    transform: string;
    variants: { ids: string[]; label: string | null; els: El[] }[];
  }
  const rawSlots: RawSlot[] = [];
  const pivots: ArtPivots = { ...DEFAULT_PIVOTS };

  const readPivots = (layer: El) => {
    for (const el of layer.getElementsByTagName("*") as unknown as El[]) {
      const name = (label(el) ?? el.getAttribute("id") ?? "").trim().toLowerCase();
      const cx = el.getAttribute("cx");
      const cy = el.getAttribute("cy");
      if (name in pivots && cx && cy) pivots[name as keyof ArtPivots] = [Number(cx), Number(cy)];
      else if (cx && cy) warnings.push(`_pivots: unknown pivot "${name}" (known: ${Object.keys(pivots).join(", ")})`);
    }
  };

  const walkLayer = (layer: El, parentTransform: string) => {
    const lbl = (label(layer) ?? layer.getAttribute("id") ?? "layer").trim();
    if (lbl.startsWith("_")) {
      if (lbl.toLowerCase() === "_pivots") readPivots(layer);
      return; // service layer — never drawn
    }
    const bracket = /\[([a-z][a-z0-9_]*)\]/i.exec(lbl);
    let key = bracket?.[1].toLowerCase() ?? SLOT_KEYS[lbl.toLowerCase()];
    if (!key) {
      key = `slot_${rawSlots.length}`;
      warnings.push(`Layer "${lbl}" has no [key] — using "${key}". Rename it like "${lbl} [mykey]".`);
    }
    if (rawSlots.some((s) => s.key === key)) warnings.push(`Two layers use the key "${key}" — keys must be unique.`);
    const transform = [parentTransform, layer.getAttribute("transform") ?? ""].filter(Boolean).join(" ");
    const roles = Array.from(lbl.matchAll(/@([a-z]+)/gi), (m) => m[1].toLowerCase());
    const unknownRoles = roles.filter((r) => !(ANIM_ROLES as readonly string[]).includes(r));
    if (unknownRoles.length) warnings.push(`Layer "${lbl}": unknown animation role(s) ${unknownRoles.map((r) => "@" + r).join(" ")} (known: ${ANIM_ROLES.map((r) => "@" + r).join(" ")})`);
    const cleanLabel = lbl.replace(/\s*\[[^\]]*\]\s*/, " ").replace(/\s*@[a-z]+/gi, "").trim();
    const slot: RawSlot = { key, label: cleanLabel, ...(roles.length ? { anim: roles } : {}), transform, variants: [] };
    const sublayers: El[] = [];
    let visibleVariant: RawSlot["variants"][number] | null = null;

    for (const child of elementChildren(layer)) {
      if (isLayer(child)) {
        sublayers.push(child);
        continue;
      }
      const id = child.getAttribute("id") ?? `anon${slot.variants.length}`;
      if (isHidden(child)) {
        slot.variants.push({ ids: [id], label: label(child), els: [child] });
      } else if (visibleVariant) {
        visibleVariant.ids.push(id);
        visibleVariant.els.push(child);
      } else {
        visibleVariant = { ids: [id], label: label(child), els: [child] };
        slot.variants.push(visibleVariant);
      }
    }
    if (slot.variants.length) rawSlots.push(slot);
    else if (!sublayers.length) warnings.push(`Layer "${lbl}" is empty — skipped.`);
    for (const sub of sublayers) walkLayer(sub, transform);
  };
  for (const child of elementChildren(root)) if (isLayer(child)) walkLayer(child, "");

  // ----------------------------------------------- palette & iris colours --
  const usedGradients = new Set<string>();
  const markGradient = (id: string) => {
    for (let g = gradients.get(id), i = 0; g && i < 10; g = gradients.get(hrefOf(g)), i++) usedGradients.add(g.getAttribute("id")!);
  };
  const paletteColors = new Set<string>();
  for (const slot of rawSlots) {
    for (const v of slot.variants) {
      for (const el of v.els) {
        const xml = xmlOf(el);
        const refs = urlRefs(xml);
        if (OWN_COLOR_SLOTS.has(slot.key)) continue; // own gradients below
        refs.forEach(markGradient);
        hexes(xml.replace(/stroke:#[0-9a-fA-F]{6}/g, "")).forEach((h) => paletteColors.add(h));
        for (const r of refs) {
          const holder = stopsHolder(r);
          if (holder) hexes(xmlOf(holder)).forEach((h) => paletteColors.add(h));
        }
      }
    }
  }
  ["#000000", "#ffffff"].forEach((c) => paletteColors.delete(c));
  const sourceColors = [...paletteColors].map((hex) => ({ hex, t: rampT(hex) })).sort((a, b) => a.t - b.t);

  const tokenizeColors = (s: string) =>
    s.replace(/#[0-9a-fA-F]{6}\b/g, (h) => {
      const i = sourceColors.findIndex((c) => c.hex === h.toLowerCase());
      return i >= 0 ? `{{c${i}}}` : h;
    });

  const clean = (el: El, isVariantRoot: boolean): string => {
    const copy = el.cloneNode(true) as El;
    const strip = (e: El) => {
      for (const a of Array.from(e.attributes as unknown as ArrayLike<Attr>)) {
        if (/^(inkscape|sodipodi):/.test(a.name)) e.removeAttribute(a.name);
      }
      elementChildren(e).forEach(strip);
    };
    strip(copy);
    if (isVariantRoot) {
      const style = (copy.getAttribute("style") ?? "").replace(/display\s*:\s*(none|inline)\s*;?/g, "").trim();
      if (style) copy.setAttribute("style", style);
      else copy.removeAttribute("style");
    }
    return roundNumbers(xmlOf(copy).replace(/\s+/g, " "));
  };

  // ------------------------------------- own-colour gradients (iris, aura) --
  let irisStops = 2;
  let auraStops = 0;
  const ownDefs: string[] = [];
  /** Re-points every url(#gradient) in `xml` to a clone whose stops are {{prefixN}} tokens. */
  const tokenGradientFill = (xml: string, newId: string, prefix: string, onStops: (n: number) => void): string =>
    xml.replace(/url\(#([^)]+)\)/g, (m, ref: string) => {
      const base = gradients.get(ref);
      const holder = stopsHolder(ref);
      if (!base || !holder) return m;
      const stops = elementChildren(holder).filter((c) => c.tagName === "stop");
      onStops(stops.length);
      if (!ownDefs.some((d) => d.includes(`id="${newId}"`))) {
        const g = base.cloneNode(false) as El;
        g.setAttribute("id", newId);
        ["xlink:href", "href", "inkscape:collect"].forEach((a) => g.removeAttribute(a));
        const stopXml = stops
          .map((st, i) => `<stop offset="${st.getAttribute("offset") ?? i / Math.max(1, stops.length - 1)}" stop-color="{{${prefix}${i}}}"/>`)
          .join("");
        ownDefs.push(roundNumbers(xmlOf(g).replace(/\/>$|><\/\w+>$/, `>${stopXml}</${g.tagName}>`)));
      }
      return `url(#${newId})`;
    });
  const irisFill = (xml: string, side: "L" | "R") =>
    tokenGradientFill(xml, `iris-${side}`, `iris${side}`, (n) => (irisStops = n));
  const centerX = (el: El): number => {
    const cx = el.getAttribute("cx") ?? el.getAttribute("x");
    return cx ? parseFloat(cx) : width / 2;
  };

  // --------------------------------------------------------------- build --
  const slots: ArtSlot[] = rawSlots.map((s) => ({
    key: s.key,
    label: s.label,
    ...(s.anim ? { anim: s.anim } : {}),
    transform: roundNumbers(s.transform),
    variants: s.variants.map((v): ArtVariant => {
      let svg: string;
      if (s.key === IRIS_SLOT) {
        svg = v.els
          .map((el) => {
            const shapes = el.tagName === "g" ? elementChildren(el) : [el];
            const inner = shapes.map((sh) => irisFill(clean(sh, false), centerX(sh) < width / 2 ? "L" : "R")).join("");
            return el.tagName === "g" ? clean(el, true).replace(/>.*<\/g>$/, `>${inner}</g>`) : inner;
          })
          .join("");
      } else if (s.key === "aura") {
        svg = v.els
          .map((el) => tokenGradientFill(clean(el, true), `aura-${v.ids[0]}`, "aura", (n) => (auraStops = Math.max(auraStops, n))))
          .join("");
      } else {
        svg = tokenizeColors(v.els.map((el) => clean(el, true)).join(""));
      }
      return { id: v.ids.join("+"), label: v.label, contains: v.els.flatMap(descendantIds), svg };
    }),
  }));

  // Only gradients something actually uses (Inkscape leaves lots of orphans).
  const defs =
    [...gradients.values()]
      .filter((g) => usedGradients.has(g.getAttribute("id")!))
      .map((g) => tokenizeColors(clean(g, false)))
      .join("") + ownDefs.join("");
  const dropped = gradients.size - usedGradients.size;

  const set: ArtSet = { id: setId, source: basename(src), width, height, defs, sourceColors, irisStops, auraStops, pivots, slots };

  const lines = [
    `Palette by lightness (t: 0 = lightest … 1 = darkest): ${sourceColors.map((c) => `${c.hex}@${c.t.toFixed(2)}`).join(" ")}`,
    `Own colours: iris ${irisStops} stops, aura ${auraStops ? auraStops + " stops" : "— no AURA layer"} · pivots: ${Object.entries(pivots).map(([k, v]) => `${k}(${v.join(",")})`).join(" ")}`,
    `Dropped ${dropped} unused gradient(s)`,
    "",
    ...slots.map((s) => `  ${s.key.padEnd(10)} «${s.label}»${s.anim ? " " + s.anim.map((r) => "@" + r).join(" ") : ""}  ${s.variants.length} variant(s): ${s.variants.map((v) => v.label ?? v.id).join(" | ")}`),
  ];
  if (warnings.length) lines.push("", "Warnings:", ...warnings.map((w) => `  - ${w}`));
  return { set, report: lines.join("\n") };
}

function writeSet(set: ArtSet) {
  const out = resolve(__dirname, `../../shared/petArt/generated/${set.id}.ts`);
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(
    out,
    `// AUTO-GENERATED by backend/scripts/import-art.ts from ${set.source} — do not edit by hand.\n` +
      `// Re-run \`npm run art:import\` after changing the Inkscape file.\n` +
      `import type { ArtSet } from "../types";\n\n` +
      `export const ART_SET_${set.id.toUpperCase()}: ArtSet = ${JSON.stringify(set, null, 1)};\n`,
  );
  return out;
}

/** Copies an outside file into art/<set>.svg (the project's source of truth), then imports it. */
function run(src: string, setId: string) {
  const projectFile = projectArt(setId);
  if (resolve(src) !== projectFile) copyFileSync(src, projectFile);
  const { set, report } = importArt(projectFile, setId);
  const out = writeSet(set);
  console.log(`[${new Date().toLocaleTimeString()}] Imported ${src}
  -> ${out}

${report}
`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const watchMode = args.includes("--watch");
  const [srcArg, setArg] = args.filter((a) => a !== "--watch");
  const setId = setArg ?? "zveri";
  const src = resolve(srcArg ?? projectArt(setId));
  if (!existsSync(src)) throw new Error(`Art file not found: ${src}`);

  run(src, setId);
  if (watchMode) {
    console.log(`Watching ${src} — save in Inkscape and the game updates (Ctrl+C to stop).`);
    let timer: NodeJS.Timeout | null = null;
    let lastMtime = statSync(src).mtimeMs;
    watch(src, () => {
      if (timer) clearTimeout(timer);
      // Inkscape writes in several chunks — wait for the save to settle.
      timer = setTimeout(() => {
        try {
          const mtime = statSync(src).mtimeMs;
          if (mtime === lastMtime) return;
          lastMtime = mtime;
          run(src, setId);
        } catch (err) {
          console.error(`Import failed (fix the file and save again): ${(err as Error).message}`);
        }
      }, 400);
    });
  }
}
