//! PetNFT pet passport — a native Solana program (no Anchor).
//!
//! The backend generates every pet's DNA off-chain and promises it never
//! changes afterwards. A passport makes that promise checkable: the owner
//! writes the pet's `dnaHash` into an account that only this program can
//! modify, and the program never lets anyone overwrite it. Anyone can read
//! the account and compare it with what the backend serves.
//!
//! Instructions (see `instruction.rs` for the account lists):
//! - `CreatePassport { name, dna_hash }` — initialise a passport account
//! - `Feed` — on-chain care counter with a cooldown enforced by the Clock sysvar
//!
//! Everything Anchor normally generates is written out by hand here:
//! instruction (de)serialization, account ownership / signer / writable
//! checks, rent-exemption check, state (de)serialization and error codes.

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint {
    use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey};

    entrypoint!(process_instruction);

    fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
        crate::processor::process_instruction(program_id, accounts, instruction_data)
    }
}
