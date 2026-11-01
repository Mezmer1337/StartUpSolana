//! PetNFT token vault — course tasks 9-10 (Vault: deposit and share tokens,
//! withdrawals through CPI).
//!
//! One vault per token mint (made for PETCOIN, works with any SPL Token or
//! Token-2022 mint). Players deposit tokens and get share tokens back; the
//! shares are their claim on the pool, so whatever lands in the vault on top
//! of deposits (game rewards, fees) is split between holders pro rata.
//!
//!   Vault        PDA ["vault",  asset_mint]  — state, and the authority of everything below
//!   share_mint   PDA ["shares", vault]       — mint authority: the vault PDA
//!   vault_tokens ATA(vault, asset_mint)      — the deposited tokens; only the vault PDA can move them
//!
//! Nobody holds a private key for the vault: withdrawals are CPIs into the
//! token program signed with the vault's seeds (`CpiContext::new_with_signer`).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("5jNEZk5S3JVBYESfjHQGX53xybUY6XHkc7xmpb2LSAFP");

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const SHARES_SEED: &[u8] = b"shares";

/// Virtual shares and assets added to both sides of the exchange rate. They
/// set the starting price at 1 share = 1 token and defeat the "first
/// depositor" inflation attack: to round a victim's deposit down to 0 shares
/// an attacker would have to donate VIRTUAL_SHARES times the victim's
/// deposit, and most of that donation goes to the virtual shares.
pub const VIRTUAL_SHARES: u128 = 1_000;
pub const VIRTUAL_ASSETS: u128 = 1_000;

#[program]
pub mod pet_vault {
    use super::*;

    /// Creates the vault for `asset_mint`, its share mint and its token account.
    /// Anyone can do it once per mint; the vault has no admin.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.asset_mint = ctx.accounts.asset_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.vault_tokens = ctx.accounts.vault_tokens.key();
        vault.total_deposited = 0;
        vault.total_withdrawn = 0;
        vault.bump = ctx.bumps.vault;
        vault.share_mint_bump = ctx.bumps.share_mint;
        msg!("Vault for {} created", vault.asset_mint);
        Ok(())
    }

    /// Moves `amount` tokens from the user into the vault and mints shares
    /// for what actually arrived. Fails if that is fewer than `min_shares`.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let assets_before = ctx.accounts.vault_tokens.amount;
        let supply_before = ctx.accounts.share_mint.supply;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_tokens.to_account_info(),
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    to: ctx.accounts.vault_tokens.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.asset_mint.decimals,
        )?;

        // A Token-2022 transfer fee (PETCOIN: 1%) is withheld from what the
        // vault receives, so shares are priced on the balance change, not on `amount`.
        ctx.accounts.vault_tokens.reload()?;
        let received = ctx
            .accounts
            .vault_tokens
            .amount
            .checked_sub(assets_before)
            .ok_or(VaultError::MathOverflow)?;

        let shares = shares_for_assets(received, assets_before, supply_before)?;
        require!(shares > 0, VaultError::ZeroShares);
        require!(shares >= min_shares, VaultError::SlippageExceeded);

        let asset_mint = ctx.accounts.asset_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint.as_ref(), &[ctx.accounts.vault.bump]]];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            shares,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposited = vault.total_deposited.checked_add(received).ok_or(VaultError::MathOverflow)?;

        emit!(Deposited { vault: vault.key(), user: ctx.accounts.user.key(), amount, received, shares });
        msg!("Deposited {} (received {}), minted {} shares", amount, received, shares);
        Ok(())
    }

    /// Burns `shares` of the user and sends their part of the vault back.
    /// The transfer out is a CPI signed by the vault PDA. Fails if the user
    /// would get fewer than `min_assets` tokens.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64, min_assets: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        let assets = assets_for_shares(shares, ctx.accounts.vault_tokens.amount, ctx.accounts.share_mint.supply)?;
        require!(assets > 0, VaultError::ZeroAmount);
        require!(assets >= min_assets, VaultError::SlippageExceeded);

        // Burn first: the user signs for their own share account, no PDA needed.
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares,
        )?;

        // The vault's token account belongs to the vault PDA. Only this
        // program can produce that signature, by passing the PDA's seeds.
        let asset_mint = ctx.accounts.asset_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, asset_mint.as_ref(), &[ctx.accounts.vault.bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_tokens.to_account_info(),
                    mint: ctx.accounts.asset_mint.to_account_info(),
                    to: ctx.accounts.user_tokens.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            assets,
            ctx.accounts.asset_mint.decimals,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_withdrawn = vault.total_withdrawn.checked_add(assets).ok_or(VaultError::MathOverflow)?;

        emit!(Withdrawn { vault: vault.key(), user: ctx.accounts.user.key(), shares, assets });
        msg!("Burned {} shares, withdrew {}", shares, assets);
        Ok(())
    }
}

/// shares = assets * (supply + V) / (total_assets + V), rounded down (in the vault's favour).
pub fn shares_for_assets(assets: u64, total_assets: u64, supply: u64) -> Result<u64> {
    mul_div(assets, supply as u128 + VIRTUAL_SHARES, total_assets as u128 + VIRTUAL_ASSETS)
}

/// assets = shares * (total_assets + V) / (supply + V), rounded down (in the vault's favour).
pub fn assets_for_shares(shares: u64, total_assets: u64, supply: u64) -> Result<u64> {
    mul_div(shares, total_assets as u128 + VIRTUAL_ASSETS, supply as u128 + VIRTUAL_SHARES)
}

fn mul_div(value: u64, numerator: u128, denominator: u128) -> Result<u64> {
    let result = (value as u128)
        .checked_mul(numerator)
        .and_then(|v| v.checked_div(denominator))
        .ok_or(VaultError::MathOverflow)?;
    u64::try_from(result).map_err(|_| error!(VaultError::MathOverflow))
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_tokens: Pubkey,
    /// Statistics only; the exchange rate uses the live balance and supply.
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
    pub share_mint_bump: u8,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub received: u64,
    pub shares: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
    pub assets: u64,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, asset_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// Same decimals as the asset, so at the starting price 1 share = 1 token.
    #[account(
        init,
        payer = payer,
        seeds = [SHARES_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = asset_mint.decimals,
        mint::authority = vault,
        mint::token_program = token_program,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = asset_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_tokens: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, asset_mint.key().as_ref()],
        bump = vault.bump,
        has_one = share_mint,
        has_one = vault_tokens,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub vault_tokens: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = asset_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_tokens: InterfaceAccount<'info, TokenAccount>,

    /// Created on the first deposit.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_shares: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, asset_mint.key().as_ref()],
        bump = vault.bump,
        has_one = share_mint,
        has_one = vault_tokens,
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub vault_tokens: InterfaceAccount<'info, TokenAccount>,

    /// Any account of this mint: a player can withdraw to another wallet.
    #[account(
        mut,
        token::mint = asset_mint,
        token::token_program = token_program,
    )]
    pub user_tokens: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_shares: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deposit too small: it would mint zero shares")]
    ZeroShares,
    #[msg("Result is below the minimum the caller accepted")]
    SlippageExceeded,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(shares_for_assets(1_000_000, 0, 0).unwrap(), 1_000_000);
        assert_eq!(assets_for_shares(1_000_000, 1_000_000, 1_000_000).unwrap(), 1_000_000);
    }

    #[test]
    fn donations_raise_the_share_price() {
        // 1000 tokens in, 1000 shares out; then 500 tokens of rewards arrive.
        let shares = assets_for_shares(1_000_000_000, 1_500_000_000, 1_000_000_000).unwrap();
        assert!(shares > 1_499_000_000 && shares <= 1_500_000_000);
        // A later depositor pays the new price: 150 tokens buy ~100 shares.
        let later = shares_for_assets(150_000_000, 1_500_000_000, 1_000_000_000).unwrap();
        assert!((99_990_000..=100_010_000).contains(&later), "{later}");
    }

    #[test]
    fn rounding_never_favours_the_user() {
        for (assets, total, supply) in [(1, 3, 2), (7, 1_000_003, 999_999), (123_456, 10, 1)] {
            let shares = shares_for_assets(assets, total, supply).unwrap();
            let back = assets_for_shares(shares, total + assets, supply + shares).unwrap();
            assert!(back <= assets, "{assets} -> {shares} -> {back}");
        }
    }

    #[test]
    fn inflation_attack_does_not_zero_out_the_victim() {
        // Attacker deposits 1 unit, then donates 1000 tokens straight to the vault.
        let (total, supply) = (1 + 1_000_000_000, 1);
        // Victim deposits 10 tokens and still gets shares worth ~ their deposit.
        let shares = shares_for_assets(10_000_000, total, supply).unwrap();
        assert!(shares > 0);
        let value = assets_for_shares(shares, total + 10_000_000, supply + shares).unwrap();
        assert!(value >= 9_000_000, "victim keeps >= 90%: {value}");
    }
}
