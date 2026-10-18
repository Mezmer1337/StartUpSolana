// Renders a grid of random hatches into a standalone HTML file — handy for
// the artist after `npm run art:import`, and for eyeballing renderer changes.
//   npm run art:gallery -- [count] [outFile]
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { deriveDnaFromSeedHash, hashSeed } from "../src/services/dnaService";
import { computeVisualKey, describeLook, generatePalette, getArtSet, DEFAULT_ART_SET, renderEggSvg, renderPetSvg, rollLook, rngFromString } from "../../shared/petArt";
import type { ArtGrowthStage, PaletteTier, PetLook, PetMood } from "../../shared/petArt";

const count = Number(process.argv[2] ?? 48);
const outFile = resolve(process.argv[3] ?? "art-gallery.html");
const stages: ArtGrowthStage[] = ["BABY", "YOUNG", "ADULT", "EVOLVED"];

function hatch() {
  const seedHash = hashSeed(randomBytes(32).toString("hex"));
  const dna = deriveDnaFromSeedHash(seedHash);
  return { dna, look: rollLook(seedHash, dna.rarity) };
}

const cell = (svg: string, caption: string) =>
  `<figure><img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}"/><figcaption>${caption}</figcaption></figure>`;
const section = (title: string, cells: string[]) => `<h2>${title}</h2><section>${cells.join("")}</section>`;

const pets = Array.from({ length: count }, hatch);
const keys = new Set(pets.map((p) => computeVisualKey(p.look, p.dna.auraType)));
const sample = pets[0].look;

// Every variant of every slot, shown on the same base pet.
const set = getArtSet(DEFAULT_ART_SET);
const variantCells = set.slots.flatMap((slot) =>
  slot.variants.length > 1 || slot.key in { horns: 1, tail: 1 }
    ? slot.variants.map((v, i) => {
        const look: PetLook = { ...sample, parts: { ...sample.parts, [slot.key]: v.id } };
        return cell(renderPetSvg({ look, auraType: null, stage: "ADULT" }), `<b>${slot.key}</b> «${slot.label}» #${i + 1} ${v.label ?? v.id}`);
      })
    : [],
);

const html = `<!doctype html><meta charset="utf-8"><title>PetNFT art gallery</title>
<style>body{background:#0a0a14;color:#ccc;font:12px system-ui;padding:16px}
section{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:28px}
figure{margin:0;background:#191929;border-radius:12px;padding:6px}img{width:100%;display:block}
figcaption{padding:4px;line-height:1.35;word-break:break-word}h2{color:#fff}</style>
${section(`${count} random hatches — ${keys.size} unique visual keys`, pets.map((p) => cell(renderPetSvg({ look: p.look, auraType: p.dna.auraType, stage: "ADULT" }, { background: true }), `<b>${p.dna.rarity}</b>${p.dna.auraType ? " · " + p.dna.auraType : ""} · ${describeLook(p.look).map((a) => `${a.trait_type}: ${a.value}`).join(", ")}`)))}
${(["common", "rare", "legendary"] as PaletteTier[])
  .map((tier) =>
    section(
      `Palettes: ${tier} (same pet)`,
      Array.from({ length: 7 }, (_, i) => {
        const palette = generatePalette(tier, rngFromString(`${tier}:${i}:${Date.now()}`));
        return cell(renderPetSvg({ look: { ...sample, palette }, auraType: null, stage: "ADULT" }), palette.name);
      }),
    ),
  )
  .join("")}
${section("Moods (animated — open in a browser)", (["idle", "happy", "sleep"] as PetMood[]).map((mood) => cell(renderPetSvg({ look: sample, auraType: null, stage: "ADULT" }, { mood }), mood)))}
${section("Every variant of every slot", variantCells)}
${section("Growth stages", stages.map((s) => cell(renderPetSvg({ look: sample, auraType: null, stage: s }), s)))}
${section("Egg / hatch frames", [0, 1, 2, 3].map((k) => cell(renderEggSvg("demo", k as 0), `crack ${k}`)))}`;

writeFileSync(outFile, html);
console.log(`Wrote ${outFile} (${count} pets, ${keys.size} unique visual keys)`);
