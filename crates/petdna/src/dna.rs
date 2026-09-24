//! Pet DNA derivation — port of deriveDnaFromSeedHash() / computeDnaHash()
//! from backend/src/services/dnaService.ts.

use serde::Serialize;

use crate::catalog::{
    Archetype, Aura, Harmony, Rarity, Socket, ARCHETYPE_OPTIONS, AURA_NONE_WEIGHT, AURA_SCORE_BONUS,
    AURA_TOTAL_WEIGHT, AURA_WEIGHTS, PATTERNS,
};
use crate::color::{generate_palette, Palette};
use crate::error::Result;
use crate::hash::sha256_hex;
use crate::rng::SeedStream;

/// Picked body parts. `None` = the archetype has no such socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetTraits {
    pub pattern: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ears: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mouth: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tail: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legs: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wings: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fins: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub special: Option<&'static str>,
}

impl PetTraits {
    fn slot_mut(&mut self, socket: Socket) -> &mut Option<&'static str> {
        match socket {
            Socket::Ears => &mut self.ears,
            Socket::Eyes => &mut self.eyes,
            Socket::Mouth => &mut self.mouth,
            Socket::Tail => &mut self.tail,
            Socket::Legs => &mut self.legs,
            Socket::Wings => &mut self.wings,
            Socket::Fins => &mut self.fins,
            Socket::Special => &mut self.special,
        }
    }

    pub fn get(&self, socket: Socket) -> Option<&'static str> {
        match socket {
            Socket::Ears => self.ears,
            Socket::Eyes => self.eyes,
            Socket::Mouth => self.mouth,
            Socket::Tail => self.tail,
            Socket::Legs => self.legs,
            Socket::Wings => self.wings,
            Socket::Fins => self.fins,
            Socket::Special => self.special,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyParams {
    pub width: f64,
    pub height: f64,
    pub size: f64,
    pub head_size: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetDna {
    pub seed_hash: String,
    pub dna_hash: String,
    pub archetype: Archetype,
    pub traits: PetTraits,
    pub body_params: BodyParams,
    pub palette: Palette,
    pub trait_score: u32,
    pub rarity: Rarity,
    pub aura_type: Option<Aura>,
}

/// sha256(seed) as hex — the seed itself is never persisted by the backend.
pub fn hash_seed(seed: &str) -> String {
    sha256_hex(seed.as_bytes())
}

/// Same shape as buildGenerationSeed(): public wallet + name + time + randomness.
/// Never a wallet private key or seed phrase.
pub fn build_generation_seed(wallet: &str, pet_name: &str, timestamp_ms: u64, nonce_hex: &str) -> String {
    format!("{wallet}:{pet_name}:{timestamp_ms}:{nonce_hex}")
}

/// `Number(x.toFixed(3))`. No value in [0.8, 1.2] sits exactly halfway
/// between two 3-decimal numbers in binary, so Rust's rounding and JS's
/// agree on every input we can see here.
fn round3(x: f64) -> f64 {
    format!("{x:.3}").parse().expect("formatted f64 parses back")
}

/// Pure function: the same seedHash always produces the exact same DNA.
pub fn derive_dna(seed_hash: &str) -> Result<PetDna> {
    let mut rng = SeedStream::new(seed_hash)?;

    let archetype_option = rng.weighted_pick(&ARCHETYPE_OPTIONS);
    let archetype = archetype_option.archetype;
    let mut score = archetype_option.rarity_points;

    let mut traits = PetTraits {
        pattern: "solid",
        ears: None,
        eyes: None,
        mouth: None,
        tail: None,
        legs: None,
        wings: None,
        fins: None,
        special: None,
    };
    for socket in Socket::PICK_ORDER {
        if archetype.has_socket(socket) {
            let picked = rng.weighted_pick(socket.options());
            score += picked.rarity_points;
            *traits.slot_mut(socket) = Some(picked.id);
        }
    }
    let pattern = rng.weighted_pick(PATTERNS);
    score += pattern.rarity_points;
    traits.pattern = pattern.id;

    let body_params = BodyParams {
        width: round3(rng.range(0.8, 1.2)),
        height: round3(rng.range(0.8, 1.2)),
        size: round3(rng.range(0.8, 1.2)),
        head_size: round3(rng.range(0.8, 1.2)),
    };

    let base_hue = rng.range(0.0, 360.0).floor() as u32;
    let harmony = Harmony::ALL[(rng.next_f64() * Harmony::ALL.len() as f64).floor() as usize];
    let saturation = rng.range(40.0, 85.0);
    let value = rng.range(40.0, 85.0);
    let palette = generate_palette(base_hue, harmony, saturation, value);

    // Aura: an independent, very-low-probability draw.
    let mut aura_roll = rng.next_f64() * f64::from(AURA_TOTAL_WEIGHT) - f64::from(AURA_NONE_WEIGHT);
    let mut aura_type = None;
    if aura_roll > 0.0 {
        for (aura, weight) in AURA_WEIGHTS {
            aura_roll -= f64::from(weight);
            if aura_roll <= 0.0 {
                aura_type = Some(aura);
                break;
            }
        }
    }
    if aura_type.is_some() {
        score += AURA_SCORE_BONUS;
    }

    let rarity = Rarity::from_score(score, aura_type.is_some());

    let mut dna = PetDna {
        seed_hash: seed_hash.to_ascii_lowercase(),
        dna_hash: String::new(),
        archetype,
        traits,
        body_params,
        palette,
        trait_score: score,
        rarity,
        aura_type,
    };
    dna.dna_hash = compute_dna_hash(&dna);
    Ok(dna)
}

/// sha256 of exactly the JSON string `JSON.stringify({...})` builds in
/// computeDnaHash(). Written by hand rather than with serde_json because the
/// hash depends on byte-exact output: JS key order (traits start with
/// "pattern", then parts in pick order) and JS number formatting (1.0 -> "1";
/// Rust's `Display` for f64 happens to print shortest round-trip form too).
pub fn compute_dna_hash(dna: &PetDna) -> String {
    sha256_hex(canonical_json(dna).as_bytes())
}

pub fn canonical_json(dna: &PetDna) -> String {
    let mut traits = format!("\"pattern\":\"{}\"", dna.traits.pattern);
    for socket in Socket::PICK_ORDER {
        if let Some(id) = dna.traits.get(socket) {
            traits.push_str(&format!(",\"{}\":\"{}\"", socket.key(), id));
        }
    }

    let b = &dna.body_params;
    let body = format!(
        "\"width\":{},\"height\":{},\"size\":{},\"headSize\":{}",
        b.width, b.height, b.size, b.head_size
    );

    let p = &dna.palette;
    let palette = format!(
        "\"baseHue\":{},\"harmony\":\"{}\",\"primary\":\"{}\",\"secondary\":\"{}\",\"patternColor\":\"{}\",\"accent\":\"{}\",\"outline\":\"{}\"",
        p.base_hue,
        p.harmony.as_str(),
        p.primary,
        p.secondary,
        p.pattern_color,
        p.accent,
        p.outline
    );

    let aura = match dna.aura_type {
        Some(aura) => format!("\"{}\"", aura.as_str()),
        None => "null".to_string(),
    };

    format!(
        "{{\"archetype\":\"{}\",\"traits\":{{{}}},\"bodyParams\":{{{}}},\"palette\":{{{}}},\"auraType\":{},\"seedHash\":\"{}\"}}",
        dna.archetype.as_str(),
        traits,
        body,
        palette,
        aura,
        dna.seed_hash
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_dna() {
        let seed_hash = hash_seed("wallet-abc:Blaze:1234567890:fixed-nonce");
        assert_eq!(derive_dna(&seed_hash).unwrap(), derive_dna(&seed_hash).unwrap());
    }

    #[test]
    fn parts_respect_archetype_sockets() {
        for i in 0..300 {
            let dna = derive_dna(&hash_seed(&format!("socket-check-{i}"))).unwrap();
            for socket in Socket::PICK_ORDER {
                assert_eq!(dna.archetype.has_socket(socket), dna.traits.get(socket).is_some());
            }
        }
    }

    #[test]
    fn body_params_in_range() {
        for i in 0..300 {
            let b = derive_dna(&hash_seed(&format!("body-{i}"))).unwrap().body_params;
            for v in [b.width, b.height, b.size, b.head_size] {
                assert!((0.8..=1.2).contains(&v), "{v}");
            }
        }
    }
}
