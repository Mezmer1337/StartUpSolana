//! Trait catalogs — a 1:1 port of backend/src/constants/dna.ts.
//!
//! ORDER MATTERS. A weighted pick walks each list front to back, exactly
//! like the TypeScript code, so reordering an entry here changes every pet
//! generated from then on (and breaks the cross-check test).

use std::fmt;
use std::str::FromStr;

use borsh::{BorshDeserialize, BorshSerialize};
use serde::Serialize;

use crate::error::PetDnaError;

/// Anything that can take part in a weighted random pick.
pub trait Weighted {
    fn weight(&self) -> u32;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraitOption {
    pub id: &'static str,
    /// Selection weight — higher means more common.
    pub weight: u32,
    /// Contribution to the Trait Score — higher means rarer.
    pub rarity_points: u32,
}

impl Weighted for TraitOption {
    fn weight(&self) -> u32 {
        self.weight
    }
}

const fn opt(id: &'static str, weight: u32, rarity_points: u32) -> TraitOption {
    TraitOption { id, weight, rarity_points }
}

// ---- Archetypes ------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Archetype {
    Round,
    Quadruped,
    Humanoid,
    Bird,
    Aquatic,
}

#[derive(Debug, Clone, Copy)]
pub struct ArchetypeOption {
    pub archetype: Archetype,
    pub weight: u32,
    pub rarity_points: u32,
}

impl Weighted for ArchetypeOption {
    fn weight(&self) -> u32 {
        self.weight
    }
}

pub const ARCHETYPE_OPTIONS: [ArchetypeOption; 5] = [
    ArchetypeOption { archetype: Archetype::Round, weight: 35, rarity_points: 0 },
    ArchetypeOption { archetype: Archetype::Quadruped, weight: 30, rarity_points: 0 },
    ArchetypeOption { archetype: Archetype::Humanoid, weight: 15, rarity_points: 2 },
    ArchetypeOption { archetype: Archetype::Bird, weight: 12, rarity_points: 2 },
    ArchetypeOption { archetype: Archetype::Aquatic, weight: 8, rarity_points: 3 },
];

/// A body-part slot. `pattern` is not a socket: every archetype gets one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Socket {
    Ears,
    Eyes,
    Mouth,
    Tail,
    Legs,
    Wings,
    Fins,
    Special,
}

impl Socket {
    /// The order dnaService.ts checks sockets in. One PRNG draw per socket
    /// the archetype has, in THIS order — not the order sockets are listed
    /// per archetype (QUADRUPED lists legs before tail, but tail is drawn first).
    pub const PICK_ORDER: [Socket; 8] = [
        Socket::Ears,
        Socket::Eyes,
        Socket::Mouth,
        Socket::Tail,
        Socket::Legs,
        Socket::Wings,
        Socket::Fins,
        Socket::Special,
    ];

    pub fn options(self) -> &'static [TraitOption] {
        match self {
            Socket::Ears => EARS,
            Socket::Eyes => EYES,
            Socket::Mouth => MOUTHS,
            Socket::Tail => TAILS,
            Socket::Legs => LEGS,
            Socket::Wings => WINGS,
            Socket::Fins => FINS,
            Socket::Special => SPECIALS,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Socket::Ears => "ears",
            Socket::Eyes => "eyes",
            Socket::Mouth => "mouth",
            Socket::Tail => "tail",
            Socket::Legs => "legs",
            Socket::Wings => "wings",
            Socket::Fins => "fins",
            Socket::Special => "special",
        }
    }
}

impl Archetype {
    pub const ALL: [Archetype; 5] =
        [Archetype::Round, Archetype::Quadruped, Archetype::Humanoid, Archetype::Bird, Archetype::Aquatic];

    pub fn as_str(self) -> &'static str {
        match self {
            Archetype::Round => "ROUND",
            Archetype::Quadruped => "QUADRUPED",
            Archetype::Humanoid => "HUMANOID",
            Archetype::Bird => "BIRD",
            Archetype::Aquatic => "AQUATIC",
        }
    }

    /// Compatible sockets (ARCHETYPE_SOCKETS in dna.ts, minus "pattern").
    pub fn sockets(self) -> &'static [Socket] {
        use Socket::*;
        match self {
            Archetype::Round => &[Ears, Eyes, Mouth, Tail],
            Archetype::Quadruped => &[Ears, Eyes, Mouth, Legs, Tail],
            Archetype::Humanoid => &[Ears, Eyes, Mouth, Legs, Special],
            Archetype::Bird => &[Eyes, Mouth, Wings, Tail],
            Archetype::Aquatic => &[Eyes, Mouth, Fins, Tail],
        }
    }

    pub fn has_socket(self, socket: Socket) -> bool {
        self.sockets().contains(&socket)
    }
}

impl fmt::Display for Archetype {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---- Body parts --------------------------------------------------------------

pub const EARS: &[TraitOption] = &[
    opt("round", 40, 0),
    opt("pointed", 30, 1),
    opt("floppy", 20, 1),
    opt("tufted", 8, 3),
    opt("none", 2, 4),
];

pub const EYES: &[TraitOption] = &[
    opt("round", 40, 0),
    opt("sharp", 25, 1),
    opt("sleepy", 20, 1),
    opt("star", 10, 3),
    opt("heterochromia", 5, 5),
];

pub const MOUTHS: &[TraitOption] = &[
    opt("smile", 40, 0),
    opt("fang", 25, 1),
    opt("beak", 20, 1),
    opt("small", 10, 1),
    opt("wide", 5, 3),
];

pub const TAILS: &[TraitOption] = &[
    opt("short", 35, 0),
    opt("long", 30, 1),
    opt("fluffy", 20, 2),
    opt("finned", 10, 2),
    opt("none", 5, 3),
];

pub const LEGS: &[TraitOption] = &[
    opt("paws", 45, 0),
    opt("claws", 30, 1),
    opt("hooves", 20, 2),
    opt("digitigrade", 5, 4),
];

pub const WINGS: &[TraitOption] = &[opt("feathered", 60, 1), opt("membrane", 30, 2), opt("tiny", 10, 3)];

pub const FINS: &[TraitOption] = &[opt("smooth", 60, 1), opt("spiked", 30, 2), opt("frilled", 10, 3)];

pub const SPECIALS: &[TraitOption] = &[
    opt("none", 85, 0),
    opt("third_eye", 5, 8),
    opt("crystal_spikes", 5, 8),
    opt("glow_marks", 4, 9),
    opt("extra_tail", 1, 12),
];

pub const PATTERNS: &[TraitOption] = &[
    opt("solid", 35, 0),
    opt("spots", 22, 1),
    opt("stripes", 20, 1),
    opt("gradient", 12, 2),
    opt("scales", 7, 3),
    opt("geometric", 4, 4),
];

// ---- Color harmony -------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Harmony {
    Analogous,
    Complementary,
    Triadic,
    SplitComplementary,
}

impl Harmony {
    pub const ALL: [Harmony; 4] =
        [Harmony::Analogous, Harmony::Complementary, Harmony::Triadic, Harmony::SplitComplementary];

    pub fn as_str(self) -> &'static str {
        match self {
            Harmony::Analogous => "analogous",
            Harmony::Complementary => "complementary",
            Harmony::Triadic => "triadic",
            Harmony::SplitComplementary => "splitComplementary",
        }
    }
}

// ---- Elemental aura ------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Aura {
    Fire,
    Water,
    Earth,
    Air,
    Lightning,
    Shadow,
    Light,
    Void,
}

impl Aura {
    pub fn as_str(self) -> &'static str {
        match self {
            Aura::Fire => "FIRE",
            Aura::Water => "WATER",
            Aura::Earth => "EARTH",
            Aura::Air => "AIR",
            Aura::Lightning => "LIGHTNING",
            Aura::Shadow => "SHADOW",
            Aura::Light => "LIGHT",
            Aura::Void => "VOID",
        }
    }
}

pub const AURA_TOTAL_WEIGHT: u32 = 1_000_000;

/// Same insertion order as AURA_WEIGHTS in dna.ts — the roll walks it in order.
pub const AURA_WEIGHTS: [(Aura, u32); 8] = [
    (Aura::Fire, 2000),
    (Aura::Water, 2000),
    (Aura::Earth, 2000),
    (Aura::Air, 2000),
    (Aura::Lightning, 800),
    (Aura::Shadow, 800),
    (Aura::Light, 100),
    (Aura::Void, 100),
];

const fn sum_aura_weights() -> u32 {
    let mut total = 0;
    let mut i = 0;
    while i < AURA_WEIGHTS.len() {
        total += AURA_WEIGHTS[i].1;
        i += 1;
    }
    total
}

pub const AURA_NONE_WEIGHT: u32 = AURA_TOTAL_WEIGHT - sum_aura_weights();

/// Flat Trait Score bonus for rolling any aura.
pub const AURA_SCORE_BONUS: u32 = 15;

// ---- Rarity --------------------------------------------------------------------

/// Declaration order = rank, so `Ord` gives COMMON < ... < MYTHIC for free.
/// Borsh encodes it as a single u8 (the variant index) — the same byte the
/// Anchor program in programs/petnft stores for its `Rarity` enum.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, BorshSerialize, BorshDeserialize,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

impl Rarity {
    pub const ALL: [Rarity; 6] =
        [Rarity::Common, Rarity::Uncommon, Rarity::Rare, Rarity::Epic, Rarity::Legendary, Rarity::Mythic];

    /// RARITY_SCORE_THRESHOLDS + rarityFromScore() from dna.ts.
    pub fn from_score(score: u32, has_aura: bool) -> Rarity {
        let base = match score {
            0..=6 => Rarity::Common,
            7..=9 => Rarity::Uncommon,
            10..=12 => Rarity::Rare,
            13..=18 => Rarity::Epic,
            19..=24 => Rarity::Legendary,
            _ => Rarity::Mythic,
        };
        // An elemental aura is always at least Legendary-tier prestige.
        if has_aura {
            base.max(Rarity::Legendary)
        } else {
            base
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Rarity::Common => "COMMON",
            Rarity::Uncommon => "UNCOMMON",
            Rarity::Rare => "RARE",
            Rarity::Epic => "EPIC",
            Rarity::Legendary => "LEGENDARY",
            Rarity::Mythic => "MYTHIC",
        }
    }
}

impl fmt::Display for Rarity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Rarity {
    type Err = PetDnaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Rarity::ALL
            .into_iter()
            .find(|r| r.as_str().eq_ignore_ascii_case(s))
            .ok_or_else(|| PetDnaError::UnknownVariant { kind: "rarity", value: s.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aura_none_weight_matches_typescript() {
        // 1_000_000 - (4 * 2000 + 2 * 800 + 2 * 100)
        assert_eq!(AURA_NONE_WEIGHT, 990_200);
    }

    #[test]
    fn rarity_thresholds_and_aura_floor() {
        assert_eq!(Rarity::from_score(6, false), Rarity::Common);
        assert_eq!(Rarity::from_score(7, false), Rarity::Uncommon);
        assert_eq!(Rarity::from_score(12, false), Rarity::Rare);
        assert_eq!(Rarity::from_score(18, false), Rarity::Epic);
        assert_eq!(Rarity::from_score(24, false), Rarity::Legendary);
        assert_eq!(Rarity::from_score(25, false), Rarity::Mythic);
        assert_eq!(Rarity::from_score(0, true), Rarity::Legendary);
        assert_eq!(Rarity::from_score(30, true), Rarity::Mythic);
    }

    #[test]
    fn rarity_parses_case_insensitively() {
        assert_eq!("epic".parse::<Rarity>().unwrap(), Rarity::Epic);
        assert!("shiny".parse::<Rarity>().is_err());
    }
}
