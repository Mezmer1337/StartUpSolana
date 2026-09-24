// Exports "golden" DNA test vectors from the TypeScript generator so the
// Rust port in crates/petdna (course week 3) can prove it produces the
// exact same pets: same archetype/traits/palette/rarity and — most
// importantly — the same dnaHash, byte for byte.
//
// Usage (from backend/):  npx tsx scripts/export-dna-vectors.ts
// Output:                 ../crates/petdna/tests/fixtures/dna_vectors.json

import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { computeDnaHash, deriveDnaFromSeedHash, hashSeed } from "../src/services/dnaService";

const OUT = resolve(__dirname, "../../crates/petdna/tests/fixtures/dna_vectors.json");

function vectorFor(seed: string) {
  const seedHash = hashSeed(seed);
  const derived = deriveDnaFromSeedHash(seedHash);
  return { seed, seedHash, dnaHash: computeDnaHash(seedHash, derived), ...derived };
}

const vectors = [];

// Seeds shaped exactly like buildGenerationSeed(): wallet:name:timestamp:nonce.
for (let i = 0; i < 200; i++) {
  vectors.push(vectorFor(`7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU:Pet${i}:${1_758_000_000_000 + i}:${i.toString(16).padStart(32, "0")}`));
}

// Auras (~1%) and MYTHIC pets are rare, so probe for a few of each to make
// sure the rare code paths are covered by the cross-check too.
const want = { aura: 6, mythic: 4 };
for (let i = 0; want.aura > 0 || want.mythic > 0; i++) {
  const v = vectorFor(`rare-probe-${i}`);
  if (v.auraType && want.aura > 0) {
    vectors.push(v);
    want.aura--;
  } else if (v.rarity === "MYTHIC" && want.mythic > 0) {
    vectors.push(v);
    want.mythic--;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ generatedBy: "backend/scripts/export-dna-vectors.ts", count: vectors.length, vectors }, null, 2) + "\n"
);
console.log(`Wrote ${vectors.length} vectors to ${OUT}`);
