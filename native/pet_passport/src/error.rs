use std::fmt;

use solana_program::program_error::ProgramError;

/// Custom errors. On-chain they surface as `custom program error: 0x<code>`;
/// clients/pet-passport.ts maps the codes back to these names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PassportError {
    AlreadyInitialized = 0,
    NotInitialized = 1,
    EmptyName = 2,
    NameTooLong = 3,
    NotOwner = 4,
    FeedCooldown = 5,
    NotRentExempt = 6,
    AccountNotWritable = 7,
    MathOverflow = 8,
}

impl From<PassportError> for ProgramError {
    fn from(err: PassportError) -> Self {
        ProgramError::Custom(err as u32)
    }
}

impl fmt::Display for PassportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::AlreadyInitialized => "passport is already initialized",
            Self::NotInitialized => "passport is not initialized",
            Self::EmptyName => "pet name is empty",
            Self::NameTooLong => "pet name is longer than 32 bytes",
            Self::NotOwner => "only the passport owner can do this",
            Self::FeedCooldown => "pet was fed too recently",
            Self::NotRentExempt => "passport account is not rent-exempt",
            Self::AccountNotWritable => "passport account must be writable",
            Self::MathOverflow => "arithmetic overflow",
        };
        f.write_str(text)
    }
}
