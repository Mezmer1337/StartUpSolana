//! Mint price and marketplace math.
//!
//! calculate_mint_price() is a port of economyService.calculateMintPrice()
//! (off-chain, so f64 is fine). The marketplace split is deliberately
//! re-done in integer lamports with checked arithmetic: that is how money
//! has to be handled inside a Solana program, where a silent overflow or
//! float rounding error means lost or minted-from-nothing SOL.

use crate::error::{PetDnaError, Result};

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

pub const BASE_PRICE_SOL: f64 = 0.1;
pub const MIN_PRICE_SOL: f64 = 0.05;
pub const MAX_PRICE_SOL: f64 = 2.0;
pub const TOTAL_SUPPLY_SOFT_CAP: f64 = 100_000.0;
pub const TARGET_MINTS_PER_HOUR: f64 = 10.0;

/// marketplaceService.MARKETPLACE_FEE_BPS / MARKETPLACE_ROYALTY_BPS.
pub const MARKETPLACE_FEE_BPS: u64 = 250;
pub const MARKETPLACE_ROYALTY_BPS: u64 = 250;
const BPS_DENOMINATOR: u64 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MintPriceQuote {
    pub price_sol: f64,
    /// What the frontend actually transfers: `Math.ceil(priceSol * LAMPORTS_PER_SOL)`.
    pub price_lamports: u64,
    pub demand_multiplier: f64,
    pub supply_multiplier: f64,
}

pub fn calculate_mint_price(total_minted: u64, minted_last_hour: u64) -> Result<MintPriceQuote> {
    let demand_multiplier = (1.0 + (minted_last_hour as f64 / TARGET_MINTS_PER_HOUR) * 0.5).clamp(0.5, 3.0);
    let supply_multiplier = (1.0 + (total_minted as f64 / TOTAL_SUPPLY_SOFT_CAP) * 1.0).clamp(1.0, 2.0);
    let price_sol = (BASE_PRICE_SOL * demand_multiplier * supply_multiplier).clamp(MIN_PRICE_SOL, MAX_PRICE_SOL);

    Ok(MintPriceQuote {
        price_sol,
        price_lamports: sol_to_lamports(price_sol)?,
        demand_multiplier,
        supply_multiplier,
    })
}

/// SOL -> lamports, rounding up like mintPayment.ts does.
pub fn sol_to_lamports(sol: f64) -> Result<u64> {
    if !sol.is_finite() || sol < 0.0 {
        return Err(PetDnaError::InvalidAmount(sol.to_string()));
    }
    let lamports = (sol * LAMPORTS_PER_SOL as f64).ceil();
    if lamports > u64::MAX as f64 {
        return Err(PetDnaError::MathOverflow);
    }
    Ok(lamports as u64)
}

pub fn lamports_to_sol(lamports: u64) -> f64 {
    lamports as f64 / LAMPORTS_PER_SOL as f64
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaleBreakdown {
    pub price: u64,
    pub platform_fee: u64,
    pub royalty: u64,
    pub seller_proceeds: u64,
}

/// `amount * bps / 10_000`, rounded down, without ever overflowing silently.
pub fn apply_bps(amount: u64, bps: u64) -> Result<u64> {
    amount
        .checked_mul(bps)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(PetDnaError::MathOverflow)
}

/// Integer-lamport version of computeSaleBreakdown(). Fees round down, so
/// any rounding dust goes to the seller and the parts always sum to price.
pub fn sale_breakdown(price_lamports: u64) -> Result<SaleBreakdown> {
    let platform_fee = apply_bps(price_lamports, MARKETPLACE_FEE_BPS)?;
    let royalty = apply_bps(price_lamports, MARKETPLACE_ROYALTY_BPS)?;
    let seller_proceeds = price_lamports
        .checked_sub(platform_fee)
        .and_then(|v| v.checked_sub(royalty))
        .ok_or(PetDnaError::MathOverflow)?;
    Ok(SaleBreakdown { price: price_lamports, platform_fee, royalty, seller_proceeds })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_is_always_clamped() {
        for (total, hour) in [(0, 0), (0, 1_000), (1_000_000, 0), (u64::MAX, u64::MAX)] {
            let q = calculate_mint_price(total, hour).unwrap();
            assert!((MIN_PRICE_SOL..=MAX_PRICE_SOL).contains(&q.price_sol));
        }
    }

    #[test]
    fn base_price_with_no_activity() {
        let q = calculate_mint_price(0, 0).unwrap();
        assert_eq!(q.price_sol, 0.1);
        assert_eq!(q.price_lamports, 100_000_000);
    }

    #[test]
    fn price_grows_with_demand_and_supply() {
        let calm = calculate_mint_price(0, 0).unwrap().price_sol;
        assert!(calculate_mint_price(0, 20).unwrap().price_sol > calm);
        assert!(calculate_mint_price(50_000, 0).unwrap().price_sol > calm);
    }

    #[test]
    fn lamport_conversions() {
        assert_eq!(sol_to_lamports(1.5).unwrap(), 1_500_000_000);
        assert!(sol_to_lamports(-1.0).is_err());
        assert!(sol_to_lamports(f64::NAN).is_err());
        assert!(sol_to_lamports(1e30).is_err());
        assert_eq!(lamports_to_sol(250_000_000), 0.25);
    }

    #[test]
    fn sale_parts_always_sum_to_price() {
        for price in [0, 1, 39, 10_000, 1_000_000_007, u64::MAX / BPS_DENOMINATOR] {
            let s = sale_breakdown(price).unwrap();
            assert_eq!(s.platform_fee + s.royalty + s.seller_proceeds, price);
        }
        let s = sale_breakdown(LAMPORTS_PER_SOL).unwrap();
        assert_eq!(s.platform_fee, 25_000_000); // 2.5%
        assert_eq!(s.seller_proceeds, 950_000_000);
    }

    #[test]
    fn overflow_is_an_error_not_a_wraparound() {
        assert_eq!(sale_breakdown(u64::MAX), Err(PetDnaError::MathOverflow));
    }
}
