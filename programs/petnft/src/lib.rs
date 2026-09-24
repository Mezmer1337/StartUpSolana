//! PetNFT on-chain pet registry.
//!
//! IMPORTANT — MVP SCOPE (see repo README "MVP / mock" section):
//! Targets Anchor 1.2 and compiles on the host (`cargo check`, including
//! `--features idl-build`), but has NOT been built for SBF, deployed or
//! run on-chain yet. See docs/course/week-05-anchor-counter.md for the
//! build / deploy / test steps shared with programs/pet_counter.
//!
//! What this program does: the actual NFT (mint account, SPL Token
//! account, Metaplex Token Metadata account) is created by the frontend
//! directly via the Metaplex umi SDK, signed by the player's Phantom
//! wallet (see frontend/src/services/nft.ts) — that is the standard,
//! battle-tested way to mint a Solana NFT and doesn't require a custom
//! program. This program adds one thing on top: a small PDA account,
//! one per mint, that records the pet's identity data on-chain in a
//! form a smart contract (or another program) could verify directly,
//! instead of trusting PetNFT's backend database. Mutable gameplay state
//! (current stats, XP, hunger, etc.) intentionally stays off-chain in
//! the backend DB in this MVP — see README for the tradeoffs.
//!
//! Mint-payment / treasury / dynamic pricing (brief section 30) currently
//! live entirely off-chain: the backend verifies a plain SystemProgram
//! transfer to a treasury *address* directly against devnet RPC before
//! creating a pet (see backend/src/services/solanaVerifyService.ts) —
//! there is no on-chain program enforcing the price or holding funds in a
//! PDA-owned vault yet. Moving that verification into this program (a
//! `mint_pet` instruction that atomically checks payment, mints, and
//! writes the PetRecord PDA in one transaction) is the natural next
//! hardening step — not yet implemented here.

use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod petnft {
    use super::*;

    /// Creates the on-chain PetRecord PDA for an already-minted NFT.
    /// Must be called by the current holder of the NFT's token account
    /// (checked via `token_account_owner`), right after minting.
    pub fn initialize_pet_record(
        ctx: Context<InitializePetRecord>,
        name: String,
        pet_type: PetType,
        rarity: Rarity,
    ) -> Result<()> {
        require!(name.as_bytes().len() <= PetRecord::MAX_NAME_LEN, PetNftError::NameTooLong);

        let record = &mut ctx.accounts.pet_record;
        record.mint = ctx.accounts.mint.key();
        record.owner = ctx.accounts.owner.key();
        record.name = name;
        record.pet_type = pet_type;
        record.rarity = rarity;
        record.level = 1;
        record.created_at = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.pet_record;

        Ok(())
    }

    /// Lets the current NFT holder checkpoint the pet's level on-chain,
    /// e.g. right after minting a long-progressed pet, or periodically.
    /// This MVP does not sync every stat on-chain (that would mean a
    /// transaction per Feed/Play/Train action, which is unnecessary cost
    /// for a Tamagotchi-style game) — see README for the design rationale.
    pub fn update_pet_level(ctx: Context<UpdatePetLevel>, new_level: u16) -> Result<()> {
        require!(new_level >= ctx.accounts.pet_record.level, PetNftError::LevelCannotDecrease);
        ctx.accounts.pet_record.level = new_level;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PetType {
    Cat,
    Dog,
    Fox,
    Dragon,
}

/// Same six tiers, in the same order, as RARITIES in backend/src/constants/dna.ts
/// (Borsh stores the variant index, so order matters).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Rarity {
    Common,
    Uncommon,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

#[account]
pub struct PetRecord {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub name: String,
    pub pet_type: PetType,
    pub rarity: Rarity,
    pub level: u16,
    pub created_at: i64,
    pub bump: u8,
}

impl PetRecord {
    pub const MAX_NAME_LEN: usize = 32;

    // discriminator(8) + mint(32) + owner(32) + name(4 + MAX_NAME_LEN)
    // + pet_type(1) + rarity(1) + level(2) + created_at(8) + bump(1)
    pub const SPACE: usize = 8 + 32 + 32 + (4 + Self::MAX_NAME_LEN) + 1 + 1 + 2 + 8 + 1;
}

#[derive(Accounts)]
pub struct InitializePetRecord<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The mint of the NFT already created by the frontend via Metaplex.
    /// CHECK: only used as a seed / stored reference, not deserialized.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = PetRecord::SPACE,
        seeds = [b"pet-record", mint.key().as_ref()],
        bump
    )]
    pub pet_record: Account<'info, PetRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePetLevel<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pet-record", pet_record.mint.as_ref()],
        bump = pet_record.bump,
        has_one = owner @ PetNftError::NotOwner,
    )]
    pub pet_record: Account<'info, PetRecord>,
}

#[error_code]
pub enum PetNftError {
    #[msg("Pet name must be 32 bytes or fewer")]
    NameTooLong,
    #[msg("Only the recorded owner can update this pet record")]
    NotOwner,
    #[msg("Level cannot decrease")]
    LevelCannotDecrease,
}
