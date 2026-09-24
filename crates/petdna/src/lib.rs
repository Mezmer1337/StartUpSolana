//! petdna — PetNFT's DNA generator and on-chain data helpers in Rust.
//!
//! Course week 3 ("Rust for Solana developers"). Each module exercises a
//! Rust feature you need for on-chain work:
//!
//! - `catalog` — enums, `match`, traits (`Weighted`, `FromStr`, `Display`), consts
//! - `rng`     — u32 wrapping arithmetic, structs with private state, generics
//! - `dna`     — ownership/borrowing, `Option`, `Result` + `?`, deterministic logic
//! - `economy` — lamports as u64, checked math, basis points
//! - `record`  — borsh serialization and the Anchor account layout
//! - `error`   — one error enum + `From` conversions (like `ProgramError`)

pub mod catalog;
pub mod color;
pub mod dna;
pub mod economy;
pub mod error;
pub mod hash;
pub mod record;
pub mod rng;
