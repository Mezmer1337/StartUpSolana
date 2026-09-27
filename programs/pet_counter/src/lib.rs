//! PetNFT care counter — the course's Anchor Counter Program (week 5).
//!
//! One counter per (owner, pet): a PDA at
//! `["care", owner, pet_id]` that counts care actions for a pet. The
//! backend keeps day-to-day care off-chain (a wallet popup for every Feed
//! would kill the game loop), so this is the opt-in, verifiable version:
//! only the owner can change it, and anyone can read it.
//!
//! Compare with native/pet_passport (week 4): the signer, owner,
//! writable, rent and (de)serialization checks written by hand there are
//! all generated here from the `#[account(...)]` constraints.

use anchor_lang::prelude::*;

declare_id!("F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P");

#[constant]
pub const COUNTER_SEED: &[u8] = b"care";

/// Backend pet ids are cuids (~25 chars). A PDA seed can be at most 32 bytes.
/// (Not `#[constant]`: the IDL has no `usize` type.)
pub const MAX_PET_ID_LEN: usize = 32;

#[program]
pub mod pet_counter {
    use super::*;

    /// Creates the counter PDA for one of the signer's pets, starting at 0.
    pub fn initialize(ctx: Context<Initialize>, pet_id: String) -> Result<()> {
        require!(!pet_id.is_empty() && pet_id.len() <= MAX_PET_ID_LEN, CounterError::InvalidPetId);

        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.pet_id = pet_id;
        counter.count = 0;
        counter.last_updated_at = Clock::get()?.unix_timestamp;
        counter.bump = ctx.bumps.counter;

        msg!("Care counter for pet {} initialized", counter.pet_id);
        Ok(())
    }

    pub fn increment(ctx: Context<UpdateCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).ok_or(CounterError::Overflow)?;
        changed(counter)
    }

    pub fn decrement(ctx: Context<UpdateCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_sub(1).ok_or(CounterError::Underflow)?;
        changed(counter)
    }

    pub fn reset(ctx: Context<UpdateCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        changed(counter)
    }

    /// Deletes the counter and refunds its rent to the owner (`close = authority`).
    pub fn close_counter(_ctx: Context<CloseCounter>) -> Result<()> {
        Ok(())
    }
}

fn changed(counter: &mut Account<CareCounter>) -> Result<()> {
    counter.last_updated_at = Clock::get()?.unix_timestamp;
    msg!("Pet {} care count: {}", counter.pet_id, counter.count);
    emit!(CareCounterChanged { counter: counter.key(), pet_id: counter.pet_id.clone(), count: counter.count });
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct CareCounter {
    pub authority: Pubkey,
    #[max_len(32)]
    pub pet_id: String,
    pub count: u64,
    pub last_updated_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(pet_id: String)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + CareCounter::INIT_SPACE,
        seeds = [COUNTER_SEED, authority.key().as_ref(), pet_id.as_bytes()],
        bump
    )]
    pub counter: Account<'info, CareCounter>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateCounter<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [COUNTER_SEED, authority.key().as_ref(), counter.pet_id.as_bytes()],
        bump = counter.bump,
        has_one = authority @ CounterError::Unauthorized,
    )]
    pub counter: Account<'info, CareCounter>,
}

#[derive(Accounts)]
pub struct CloseCounter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [COUNTER_SEED, authority.key().as_ref(), counter.pet_id.as_bytes()],
        bump = counter.bump,
        has_one = authority @ CounterError::Unauthorized,
        close = authority,
    )]
    pub counter: Account<'info, CareCounter>,
}

#[event]
pub struct CareCounterChanged {
    pub counter: Pubkey,
    pub pet_id: String,
    pub count: u64,
}

#[error_code]
pub enum CounterError {
    #[msg("pet_id must be 1-32 bytes")]
    InvalidPetId,
    #[msg("Only the counter's authority can change it")]
    Unauthorized,
    #[msg("Counter overflow")]
    Overflow,
    #[msg("Counter is already zero")]
    Underflow,
}
