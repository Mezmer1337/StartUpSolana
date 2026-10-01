//! PetNFT on-chain player profile — course week 6 (Accounts, PDAs and
//! program architecture).
//!
//! A decentralized profile: it lives in a PDA owned by this program, not in
//! PetNFT's database. Nobody needs to store its address — anyone can derive
//! it from the wallet:
//!
//!   PlayerProfile   PDA ["profile",  wallet]    — one per wallet
//!   UsernameRecord  PDA ["username", username]  — one per username, so a
//!                   username can only ever be held by one wallet: `init`
//!                   fails if the PDA already exists. Also a reverse lookup:
//!                   username -> wallet -> profile.
//!
//! The featured pet must be a real PetRecord PDA of programs/petnft owned by
//! the same wallet: this program reads and checks another program's account
//! (owner program, discriminator, seeds) without trusting the client.

use anchor_lang::prelude::*;
use petnft::PetRecord;

declare_id!("CP6Fmq98dsLrpev7EjEVvuGQ1z2aG9H7vAuDiRPDnYkB");

#[constant]
pub const PROFILE_SEED: &[u8] = b"profile";
#[constant]
pub const USERNAME_SEED: &[u8] = b"username";

/// Not `#[constant]`: the IDL has no `usize` type.
pub const MIN_USERNAME_LEN: usize = 3;
pub const MAX_USERNAME_LEN: usize = 20;
pub const MAX_BIO_LEN: usize = 160;

#[program]
pub mod player_profile {
    use super::*;

    /// Creates the caller's profile and claims `username` for them.
    pub fn create_profile(ctx: Context<CreateProfile>, username: String, bio: String) -> Result<()> {
        validate_username(&username)?;
        validate_bio(&bio)?;
        let now = Clock::get()?.unix_timestamp;
        let authority = ctx.accounts.authority.key();

        let profile = &mut ctx.accounts.profile;
        profile.authority = authority;
        profile.username = username;
        profile.bio = bio;
        profile.featured_pet = None;
        profile.created_at = now;
        profile.updated_at = now;
        profile.bump = ctx.bumps.profile;

        let record = &mut ctx.accounts.username_record;
        record.authority = authority;
        record.bump = ctx.bumps.username_record;

        msg!("Profile @{} created for {}", profile.username, authority);
        Ok(())
    }

    pub fn update_bio(ctx: Context<UpdateProfile>, bio: String) -> Result<()> {
        validate_bio(&bio)?;
        let profile = &mut ctx.accounts.profile;
        profile.bio = bio;
        profile.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Releases the old username (its PDA is closed, rent refunded) and
    /// claims the new one, atomically.
    pub fn change_username(ctx: Context<ChangeUsername>, new_username: String) -> Result<()> {
        validate_username(&new_username)?;
        let record = &mut ctx.accounts.new_username_record;
        record.authority = ctx.accounts.authority.key();
        record.bump = ctx.bumps.new_username_record;

        let profile = &mut ctx.accounts.profile;
        msg!("Username @{} -> @{}", profile.username, new_username);
        profile.username = new_username;
        profile.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Shows one of the caller's pets on the profile. All the checks are in
    /// the `SetFeaturedPet` accounts struct.
    pub fn set_featured_pet(ctx: Context<SetFeaturedPet>) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.featured_pet = Some(ctx.accounts.pet_record.key());
        profile.updated_at = Clock::get()?.unix_timestamp;
        msg!("Featured pet: {}", ctx.accounts.pet_record.name);
        Ok(())
    }

    pub fn clear_featured_pet(ctx: Context<UpdateProfile>) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.featured_pet = None;
        profile.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Deletes the profile and frees the username; all rent goes back to the owner.
    pub fn close_profile(_ctx: Context<CloseProfile>) -> Result<()> {
        Ok(())
    }
}

/// Lowercase letters, digits and `_` only, so "Blaze" and "blaze" can't be
/// two different users, and the username is always a valid PDA seed.
fn validate_username(username: &str) -> Result<()> {
    let valid_chars = username.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    require!(
        valid_chars && (MIN_USERNAME_LEN..=MAX_USERNAME_LEN).contains(&username.len()),
        ProfileError::InvalidUsername
    );
    Ok(())
}

fn validate_bio(bio: &str) -> Result<()> {
    require!(bio.len() <= MAX_BIO_LEN, ProfileError::BioTooLong);
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub authority: Pubkey,
    #[max_len(20)]
    pub username: String,
    #[max_len(160)]
    pub bio: String,
    /// A petnft PetRecord PDA owned by `authority`.
    pub featured_pet: Option<Pubkey>,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UsernameRecord {
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(username: String)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, PlayerProfile>,

    /// `init` fails if someone already holds this username.
    #[account(
        init,
        payer = authority,
        space = 8 + UsernameRecord::INIT_SPACE,
        seeds = [USERNAME_SEED, username.as_bytes()],
        bump
    )]
    pub username_record: Account<'info, UsernameRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority @ ProfileError::Unauthorized,
    )]
    pub profile: Account<'info, PlayerProfile>,
}

#[derive(Accounts)]
#[instruction(new_username: String)]
pub struct ChangeUsername<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority @ ProfileError::Unauthorized,
    )]
    pub profile: Account<'info, PlayerProfile>,

    #[account(
        mut,
        seeds = [USERNAME_SEED, profile.username.as_bytes()],
        bump = old_username_record.bump,
        has_one = authority @ ProfileError::Unauthorized,
        close = authority,
    )]
    pub old_username_record: Account<'info, UsernameRecord>,

    #[account(
        init,
        payer = authority,
        space = 8 + UsernameRecord::INIT_SPACE,
        seeds = [USERNAME_SEED, new_username.as_bytes()],
        bump
    )]
    pub new_username_record: Account<'info, UsernameRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetFeaturedPet<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority @ ProfileError::Unauthorized,
    )]
    pub profile: Account<'info, PlayerProfile>,

    /// An account of ANOTHER program. `Account<PetRecord>` checks it is owned
    /// by petnft and starts with PetRecord's discriminator; `seeds::program`
    /// re-derives it as petnft's ["pet-record", mint] PDA; the constraint
    /// checks the pet belongs to the caller.
    #[account(
        seeds = [b"pet-record", pet_record.mint.as_ref()],
        bump = pet_record.bump,
        seeds::program = petnft::ID,
        constraint = pet_record.owner == authority.key() @ ProfileError::NotPetOwner,
    )]
    pub pet_record: Account<'info, PetRecord>,
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority @ ProfileError::Unauthorized,
        close = authority,
    )]
    pub profile: Account<'info, PlayerProfile>,

    #[account(
        mut,
        seeds = [USERNAME_SEED, profile.username.as_bytes()],
        bump = username_record.bump,
        has_one = authority @ ProfileError::Unauthorized,
        close = authority,
    )]
    pub username_record: Account<'info, UsernameRecord>,
}

#[error_code]
pub enum ProfileError {
    #[msg("Username must be 3-20 characters: lowercase letters, digits or _")]
    InvalidUsername,
    #[msg("Bio must be 160 bytes or fewer")]
    BioTooLong,
    #[msg("Only the profile owner can do this")]
    Unauthorized,
    #[msg("This pet belongs to another wallet")]
    NotPetOwner,
}
