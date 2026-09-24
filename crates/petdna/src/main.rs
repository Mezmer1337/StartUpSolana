use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::{Parser, Subcommand};

use petdna::catalog::{Archetype, Rarity, Socket};
use petdna::dna::{build_generation_seed, derive_dna, hash_seed, PetDna};
use petdna::economy::{calculate_mint_price, lamports_to_sol, sale_breakdown, sol_to_lamports};
use petdna::error::{PetDnaError, Result};
use petdna::hash::to_hex;
use petdna::record::{PetRecord, PetType, Pubkey};

#[derive(Parser)]
#[command(name = "petdna", version, about = "PetNFT DNA toolkit — Rust port of the backend DNA generator")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Generate a pet the way POST /api/pets/mint does (wallet:name:timestamp:nonce -> sha256 -> DNA)
    Generate {
        /// Owner wallet (base58 public key)
        #[arg(long)]
        wallet: Pubkey,
        #[arg(long)]
        name: String,
        /// Unix time in ms (default: now)
        #[arg(long)]
        timestamp: Option<u64>,
        /// 32 hex chars (default: 16 random bytes)
        #[arg(long)]
        nonce: Option<String>,
        /// Print JSON instead of a table
        #[arg(long)]
        json: bool,
    },
    /// Re-derive the DNA from a stored Pet.seedHash
    FromHash {
        seed_hash: String,
        #[arg(long)]
        json: bool,
    },
    /// Rarity / archetype / aura distribution over many generated pets
    Sample {
        #[arg(long, default_value_t = 10_000)]
        count: u32,
        #[arg(long, default_value = "sample")]
        prefix: String,
    },
    /// Dynamic mint price in SOL and lamports (economyService.calculateMintPrice)
    Price {
        #[arg(long)]
        total_minted: u64,
        #[arg(long)]
        minted_last_hour: u64,
    },
    /// Marketplace sale split in lamports, using checked integer math
    Sale {
        #[arg(long)]
        price_sol: f64,
    },
    /// Serialize a PetRecord exactly like the Anchor account in programs/petnft
    Record {
        #[arg(long)]
        mint: Pubkey,
        #[arg(long)]
        owner: Pubkey,
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "cat")]
        pet_type: PetType,
        #[arg(long, default_value = "common")]
        rarity: Rarity,
        #[arg(long, default_value_t = 1)]
        level: u16,
        #[arg(long, default_value_t = 0)]
        created_at: i64,
        #[arg(long, default_value_t = 255)]
        bump: u8,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse().command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<()> {
    match command {
        Command::Generate { wallet, name, timestamp, nonce, json } => {
            let timestamp = timestamp.unwrap_or_else(now_ms);
            let nonce = match nonce {
                Some(nonce) => nonce,
                None => random_nonce()?,
            };
            let seed = build_generation_seed(&wallet.to_string(), &name, timestamp, &nonce);
            let dna = derive_dna(&hash_seed(&seed))?;
            if json {
                print_json(&dna);
            } else {
                println!("seed        : {seed}");
                print_dna(&dna);
            }
        }
        Command::FromHash { seed_hash, json } => {
            let dna = derive_dna(&seed_hash)?;
            if json {
                print_json(&dna);
            } else {
                print_dna(&dna);
            }
        }
        Command::Sample { count, prefix } => sample(count, &prefix)?,
        Command::Price { total_minted, minted_last_hour } => {
            let q = calculate_mint_price(total_minted, minted_last_hour)?;
            println!("demand x{:.3} * supply x{:.3}", q.demand_multiplier, q.supply_multiplier);
            println!("price       : {} SOL = {} lamports", q.price_sol, q.price_lamports);
        }
        Command::Sale { price_sol } => {
            let s = sale_breakdown(sol_to_lamports(price_sol)?)?;
            for (label, lamports) in [
                ("price", s.price),
                ("platform fee", s.platform_fee),
                ("royalty", s.royalty),
                ("seller gets", s.seller_proceeds),
            ] {
                println!("{label:<13}: {lamports:>15} lamports ({} SOL)", lamports_to_sol(lamports));
            }
        }
        Command::Record { mint, owner, name, pet_type, rarity, level, created_at, bump } => {
            let record = PetRecord { mint, owner, name, pet_type, rarity, level, created_at, bump };
            let data = record.to_account_data()?;
            println!("discriminator : {}", to_hex(&PetRecord::discriminator()));
            println!("account size  : {} bytes (PetRecord::SPACE)", data.len());
            println!("account data  : {}", to_hex(&data));
            let decoded = PetRecord::from_account_data(&data)?;
            println!("decoded back  : {decoded:?}");
        }
    }
    Ok(())
}

fn print_dna(dna: &PetDna) {
    let parts: Vec<String> = Socket::PICK_ORDER
        .iter()
        .filter_map(|s| dna.traits.get(*s).map(|id| format!("{}={id}", s.key())))
        .collect();
    let b = &dna.body_params;
    let p = &dna.palette;

    println!("seedHash    : {}", dna.seed_hash);
    println!("dnaHash     : {}", dna.dna_hash);
    println!("archetype   : {}", dna.archetype);
    println!("traits      : {} pattern={}", parts.join(" "), dna.traits.pattern);
    println!("body        : width={} height={} size={} headSize={}", b.width, b.height, b.size, b.head_size);
    println!("palette     : {} (hue {}) {} {} {}", p.harmony.as_str(), p.base_hue, p.primary, p.secondary, p.accent);
    println!("trait score : {} -> {}", dna.trait_score, dna.rarity);
    println!("aura        : {}", dna.aura_type.map_or("none", |a| a.as_str()));
}

fn print_json(dna: &PetDna) {
    println!("{}", serde_json::to_string_pretty(dna).expect("PetDna always serializes"));
}

fn sample(count: u32, prefix: &str) -> Result<()> {
    let mut by_rarity: BTreeMap<Rarity, u32> = Rarity::ALL.iter().map(|r| (*r, 0)).collect();
    let mut by_archetype: BTreeMap<Archetype, u32> = BTreeMap::new();
    let mut auras = 0u32;

    for i in 0..count {
        let dna = derive_dna(&hash_seed(&format!("{prefix}-{i}")))?;
        *by_rarity.entry(dna.rarity).or_default() += 1;
        *by_archetype.entry(dna.archetype).or_default() += 1;
        auras += u32::from(dna.aura_type.is_some());
    }

    let pct = |n: u32| f64::from(n) * 100.0 / f64::from(count.max(1));
    println!("{count} pets\n\nrarity:");
    for (rarity, n) in &by_rarity {
        println!("  {:<10} {:>7} {:>7.2}%", rarity.as_str(), n, pct(*n));
    }
    println!("\narchetype:");
    for (archetype, n) in &by_archetype {
        println!("  {:<10} {:>7} {:>7.2}%", archetype.as_str(), n, pct(*n));
    }
    println!("\nwith aura: {auras} ({:.3}%)", pct(auras));
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 16 random bytes as hex, like `randomBytes(16).toString("hex")` in the backend.
fn random_nonce() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| PetDnaError::Serialization(format!("OS randomness unavailable: {e}")))?;
    Ok(to_hex(&bytes))
}
