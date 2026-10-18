import { describe, expect, it } from "vitest";
import { deriveDnaFromSeedHash, hashSeed } from "../src/services/dnaService";
import {
  DEFAULT_ART_SET,
  OPTIONAL_SLOT_CHANCE,
  computeVisualKey,
  describeLook,
  generatePalette,
  getArtSet,
  lookFromRecord,
  renderEggSvg,
  renderPetSvg,
  resolveVariant,
  rngFromString,
  rollLook,
  sampleRamp,
} from "../../shared/petArt";
import { hueOf } from "../../shared/petArt/color";
import { TRAINING_GAMES, strengthPerks, trainingRewards } from "../../shared/game/training";
import { AURA_SCHEMES } from "../../shared/petArt";

const hatch = (i: number) => {
  const seedHash = hashSeed(`art-test-${i}`);
  const dna = deriveDnaFromSeedHash(seedHash);
  return { dna, look: rollLook(seedHash, dna.rarity) };
};
const N = 4000;
const sample = Array.from({ length: N }, (_, i) => hatch(i));

describe("shared/petArt — hand-drawn art set", () => {
  const set = getArtSet(DEFAULT_ART_SET);

  it("imported every layer of the Inkscape file with at least one variant", () => {
    expect(set.slots.length).toBeGreaterThanOrEqual(17);
    for (const slot of set.slots) expect(slot.variants.length).toBeGreaterThan(0);
    expect(set.slots.map((s) => s.key)).toEqual(expect.arrayContaining(["horns", "tail", "iris", "ears", "mouth"]));
  });

  it("is deterministic: same seed -> same look -> byte-identical SVG", () => {
    const a = hatch(1);
    const b = hatch(1);
    expect(a.look).toEqual(b.look);
    expect(renderPetSvg({ look: a.look, auraType: null, stage: "ADULT" })).toBe(
      renderPetSvg({ look: b.look, auraType: null, stage: "ADULT" }),
    );
  });

  it("renders standalone SVG with every colour token resolved and no editor attributes", () => {
    for (const { dna, look } of sample.slice(0, 300)) {
      const svg = renderPetSvg({ look, auraType: dna.auraType, stage: "ADULT" }, { background: true });
      expect(svg).not.toMatch(/\{\{|NaN|undefined|inkscape:|sodipodi:/);
    }
  });

  it("heterochromia ~50%, matching eyes otherwise", () => {
    const hetero = sample.filter((p) => p.look.eyes.hetero);
    expect(hetero.length / N).toBeGreaterThan(0.45);
    expect(hetero.length / N).toBeLessThan(0.55);
    for (const p of sample.filter((x) => !x.look.eyes.hetero)) expect(p.look.eyes.left).toEqual(p.look.eyes.right);
  });

  it("horns and tail are rare, and rarer pets get them more often", () => {
    const rate = (slot: string, pets = sample) => pets.filter((p) => p.look.parts[slot] !== null).length / pets.length;
    for (const slot of Object.keys(OPTIONAL_SLOT_CHANCE)) {
      expect(rate(slot)).toBeGreaterThan(0.04);
      expect(rate(slot)).toBeLessThan(0.2);
    }
    const common = sample.filter((p) => p.dna.rarity === "COMMON");
    const rare = sample.filter((p) => ["RARE", "EPIC", "LEGENDARY", "MYTHIC"].includes(p.dna.rarity));
    expect(rate("horns", rare)).toBeGreaterThan(rate("horns", common));
  });

  it("palette tiers: common = one hue, rare = two, legendary = three; fancier is rarer", () => {
    const tiers = sample.map((p) => p.look.palette.tier);
    const share = (t: string) => tiers.filter((x) => x === t).length / N;
    expect(share("common")).toBeGreaterThan(0.75);
    expect(share("rare")).toBeGreaterThan(0.05);
    expect(share("legendary")).toBeGreaterThan(0.003);
    expect(share("legendary")).toBeLessThan(share("rare"));
    for (const tier of ["common", "rare", "legendary"] as const) {
      const pal = generatePalette(tier, rngFromString(`t:${tier}`));
      expect(pal.hues.length).toBe({ common: 1, rare: 2, legendary: 3 }[tier]);
    }
  });

  it("common palettes stay within one hue", () => {
    for (let i = 0; i < 200; i++) {
      const pal = generatePalette("common", rngFromString(`mono:${i}`));
      const hues = pal.stops.map(([, c]) => hueOf(c));
      const spread = Math.max(...hues.map((h) => Math.min(Math.abs(h - hues[0]), 360 - Math.abs(h - hues[0]))));
      expect(spread).toBeLessThan(14); // ±6° drift + rounding of light/dark shades
    }
  });

  it("body colours come from the pet's palette ramp", () => {
    for (const { look } of sample.slice(0, 100)) {
      const svg = renderPetSvg({ look, auraType: null, stage: "ADULT" });
      for (const c of set.sourceColors) expect(svg).toContain(sampleRamp(look.palette.stops, c.t));
    }
  });

  it("old v1 looks (named palette + perm) still render their original colours", () => {
    const v1 = { v: 1, set: "zveri", parts: rollLook("x", "COMMON").parts, palette: "ocean", perm: [0, 1, 2, 3, 4, 5, 6], eyes: { hetero: false, left: ["#123456", "#abcdef"], right: ["#123456", "#abcdef"] } };
    const look = lookFromRecord({ seedHash: "x", rarity: "COMMON", look: JSON.stringify(v1), auraType: null, level: 1 });
    const svg = renderPetSvg({ look, auraType: null, stage: "ADULT" });
    for (const c of ["#e0f7f4", "#2c84b8", "#263a7a"]) expect(svg).toContain(c); // ocean[0], [4], [6]
  });

  it("a stored variant id survives the artist regrouping objects", () => {
    const ears = set.slots.find((s) => s.key === "ears")!;
    const grouped = ears.variants.find((v) => v.contains.length > 1 && v.id !== v.contains.join("+"));
    if (!grouped) return; // nothing regrouped in the current file
    const legacyId = grouped.contains.filter((id) => id !== grouped.id).join("+");
    expect(resolveVariant(ears, legacyId).id).toBe(grouped.id);
  });

  it("animated moods embed CSS, the NFT image stays static", () => {
    const { look } = sample[0];
    expect(renderPetSvg({ look, auraType: null, stage: "ADULT" })).not.toContain("@keyframes");
    for (const mood of ["idle", "happy", "sleep"] as const) {
      const svg = renderPetSvg({ look, auraType: null, stage: "ADULT" }, { mood });
      expect(svg).toContain("@keyframes");
      expect(svg).toContain('class="a-head"');
    }
  });

  it("gives distinct visual keys to a large random sample", () => {
    const keys = new Set(sample.map((p) => computeVisualKey(p.look, p.dna.auraType)));
    // Collisions are possible in principle (the DB re-rolls them), but should be rare.
    expect(keys.size).toBeGreaterThan(N * 0.995);
  });

  it("describes the visible parts for NFT attributes", () => {
    const attrs = describeLook(sample[0].look);
    expect(attrs.find((a) => a.trait_type === "Horns")).toBeDefined();
    expect(attrs.find((a) => a.trait_type === "Palette")).toBeDefined();
  });

  it("training rewards: medals, stat gains and XP scale with score", () => {
    const def = TRAINING_GAMES.POWER;
    expect(trainingRewards(100, def)).toMatchObject({ medal: "gold", statGain: 3, xp: 50 });
    expect(trainingRewards(55, def)).toMatchObject({ medal: "silver", statGain: 2 });
    expect(trainingRewards(25, def)).toMatchObject({ medal: "bronze", statGain: 1 });
    expect(trainingRewards(0, def)).toMatchObject({ medal: "none", statGain: 0, xp: 10 });
    expect(trainingRewards(999, def).score).toBe(100);
  });

  it("aura: the artist's AURA layer shows only on aura pets, recoloured per element", () => {
    const { look } = sample[0];
    const plain = renderPetSvg({ look, auraType: null, stage: "ADULT" });
    expect(plain).not.toContain("url(#aura-");
    expect(look.parts.aura).toBeUndefined(); // never rolled as a normal part
    const seen = new Set<string>();
    for (const [type, scheme] of Object.entries(AURA_SCHEMES)) {
      const svg = renderPetSvg({ look, auraType: type, stage: "ADULT" });
      expect(svg).toContain("url(#aura-");
      expect(svg).toContain(scheme.colors[0]);
      expect(svg).not.toMatch(/\{\{aura/);
      seen.add(scheme.colors.join());
    }
    expect(seen.size).toBe(Object.keys(AURA_SCHEMES).length); // every element looks different
  });

  it("run mood splits legs and arms into left/right halves that move in turn", () => {
    const svg = renderPetSvg({ look: sample[0].look, auraType: null, stage: "ADULT" }, { mood: "run" });
    expect(svg).toContain('id="half-L"');
    expect(svg).toContain('class="a-strideL"');
    expect(svg).toContain('class="a-strideR"');
    expect(svg).toContain("@keyframes strideL");
    expect(renderPetSvg({ look: sample[0].look, auraType: null, stage: "ADULT" }, { mood: "idle" })).not.toContain("a-strideL");
  });

  it("arcade games score in the hundreds but pay out on the same 0..100 performance scale", () => {
    const snake = TRAINING_GAMES.SNAKE;
    expect(snake.stat).toBe("strength");
    expect(trainingRewards(snake.fullMarks, snake)).toMatchObject({ medal: "gold", statGain: 3, xp: 50 });
    expect(trainingRewards(snake.fullMarks / 2, snake).medal).toBe("silver");
    expect(trainingRewards(3000, snake).xp).toBe(50); // capped at 100%
    expect(trainingRewards(3000, snake).score).toBe(3000); // raw score kept for high scores
  });

  it("strength perks grow with Strength", () => {
    expect(strengthPerks(10)).toMatchObject({ extraLives: 0, shields: 0 });
    expect(strengthPerks(25)).toMatchObject({ extraLives: 1, shields: 1 });
    expect(strengthPerks(70)).toMatchObject({ extraLives: 2, shields: 3 });
  });

  it("renders every egg crack stage", () => {
    for (const k of [0, 1, 2, 3] as const) expect(renderEggSvg("x", k)).toContain("<svg");
  });
});
