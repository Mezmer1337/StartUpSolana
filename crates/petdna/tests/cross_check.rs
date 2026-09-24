//! The Rust port must generate exactly the same pets as the TypeScript
//! backend. Fixtures come from backend/scripts/export-dna-vectors.ts —
//! re-run it whenever the trait catalogs change.

use petdna::dna::{derive_dna, hash_seed};
use serde::Deserialize;

#[derive(Deserialize)]
struct VectorFile {
    vectors: Vec<Vector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    seed: String,
    seed_hash: String,
    dna_hash: String,
    archetype: String,
    trait_score: u32,
    rarity: String,
    aura_type: Option<String>,
    palette: Palette,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Palette {
    base_hue: u32,
    primary: String,
    outline: String,
}

#[test]
fn rust_port_matches_typescript_backend() {
    let file: VectorFile = serde_json::from_str(include_str!("fixtures/dna_vectors.json")).unwrap();
    assert!(file.vectors.len() >= 200);

    let mut saw_aura = false;
    let mut saw_mythic = false;
    for v in &file.vectors {
        assert_eq!(hash_seed(&v.seed), v.seed_hash, "seed hash for {}", v.seed);

        let dna = derive_dna(&v.seed_hash).unwrap();
        assert_eq!(dna.archetype.as_str(), v.archetype, "archetype for {}", v.seed);
        assert_eq!(dna.palette.base_hue, v.palette.base_hue, "baseHue for {}", v.seed);
        assert_eq!(dna.palette.primary, v.palette.primary, "primary for {}", v.seed);
        assert_eq!(dna.palette.outline, v.palette.outline, "outline for {}", v.seed);
        assert_eq!(dna.trait_score, v.trait_score, "trait score for {}", v.seed);
        assert_eq!(dna.rarity.as_str(), v.rarity, "rarity for {}", v.seed);
        assert_eq!(dna.aura_type.map(|a| a.as_str().to_string()), v.aura_type, "aura for {}", v.seed);
        // dnaHash covers every field, so this is the byte-for-byte check.
        assert_eq!(dna.dna_hash, v.dna_hash, "dnaHash for {}", v.seed);

        saw_aura |= dna.aura_type.is_some();
        saw_mythic |= v.rarity == "MYTHIC";
    }
    assert!(saw_aura && saw_mythic, "fixtures must cover the rare aura / MYTHIC paths");
}
