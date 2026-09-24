//! Deterministic randomness — a bit-exact port of mulberry32() and
//! seedStream() from backend/src/services/dnaService.ts.
//!
//! JavaScript does this math on doubles and coerces with `| 0` / `>>> 0`;
//! in Rust the same thing is plain u32 arithmetic with explicit
//! `wrapping_*` calls. (In debug builds a bare `+` on u32 would panic on
//! overflow — the same reason Solana programs use checked/wrapping math.)

use crate::catalog::Weighted;
use crate::error::{PetDnaError, Result};
use crate::hash::sha256_hex;

/// Mulberry32: tiny, fast, deterministic 32-bit PRNG.
#[derive(Debug, Clone)]
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// Next value in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let a = self.state;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

/// Stream of random numbers derived from one sha256 hex digest.
///
/// Walks the digest 8 hex chars (32 bits) at a time to seed a fresh
/// Mulberry32 every 8 draws, and re-hashes the digest once it runs out.
#[derive(Debug, Clone)]
pub struct SeedStream {
    hex: String,
    offset: usize,
    rng: Mulberry32,
    draws_on_this_rng: u32,
}

impl SeedStream {
    pub fn new(seed_hash: &str) -> Result<Self> {
        let valid = seed_hash.len() == 64 && seed_hash.bytes().all(|b| b.is_ascii_hexdigit());
        if !valid {
            return Err(PetDnaError::InvalidSeedHash(seed_hash.to_string()));
        }
        let mut stream = Self {
            hex: seed_hash.to_ascii_lowercase(),
            offset: 0,
            rng: Mulberry32::new(0),
            draws_on_this_rng: 0,
        };
        stream.rng = Mulberry32::new(stream.next_seed());
        Ok(stream)
    }

    fn next_seed(&mut self) -> u32 {
        if self.offset + 8 > self.hex.len() {
            self.hex = sha256_hex(self.hex.as_bytes());
            self.offset = 0;
        }
        let chunk = &self.hex[self.offset..self.offset + 8];
        self.offset += 8;
        u32::from_str_radix(chunk, 16).expect("hex was validated in SeedStream::new")
    }

    /// Next value in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        // JS: `if (drawsOnThisRng++ > 6)` — compare the OLD value, then increment.
        let previous = self.draws_on_this_rng;
        self.draws_on_this_rng += 1;
        if previous > 6 {
            self.rng = Mulberry32::new(self.next_seed());
            self.draws_on_this_rng = 0;
        }
        self.rng.next_f64()
    }

    /// `min + rand() * (max - min)` — same operation order as the TS `range()`.
    pub fn range(&mut self, min: f64, max: f64) -> f64 {
        min + self.next_f64() * (max - min)
    }

    /// Weighted pick: roll in [0, total), subtract weights until <= 0.
    pub fn weighted_pick<'a, T: Weighted>(&mut self, options: &'a [T]) -> &'a T {
        let total: f64 = options.iter().map(|o| f64::from(o.weight())).sum();
        let mut roll = self.next_f64() * total;
        for option in options {
            roll -= f64::from(option.weight());
            if roll <= 0.0 {
                return option;
            }
        }
        options.last().expect("weighted_pick needs at least one option")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulberry32_is_deterministic_and_in_unit_interval() {
        let mut a = Mulberry32::new(42);
        let mut b = Mulberry32::new(42);
        for _ in 0..1000 {
            let x = a.next_f64();
            assert_eq!(x, b.next_f64());
            assert!((0.0..1.0).contains(&x));
        }
    }

    #[test]
    fn rejects_malformed_seed_hash() {
        assert!(SeedStream::new("abc").is_err());
        assert!(SeedStream::new(&"z".repeat(64)).is_err());
        assert!(SeedStream::new(&"a".repeat(64)).is_ok());
    }
}
