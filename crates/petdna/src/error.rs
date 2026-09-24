use std::fmt;

/// Every way a petdna operation can fail.
///
/// This mirrors how Solana programs model errors: one enum, one variant per
/// failure, and `From` conversions so `?` works everywhere. On-chain the enum
/// would be turned into `ProgramError::Custom(code)` (see native/pet_passport).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PetDnaError {
    /// seedHash must be exactly 64 hex chars (a sha256 digest).
    InvalidSeedHash(String),
    /// Not a base58 string that decodes to exactly 32 bytes.
    InvalidPubkey(String),
    /// Negative, NaN or infinite SOL amount.
    InvalidAmount(String),
    /// Unknown value for an enum-like CLI argument (pet type, rarity, ...).
    UnknownVariant { kind: &'static str, value: String },
    NameTooLong { len: usize, max: usize },
    /// A checked arithmetic operation (checked_add / checked_mul / ...) failed.
    MathOverflow,
    /// Borsh (de)serialization failed.
    Serialization(String),
    /// Account data does not start with the expected Anchor discriminator.
    DiscriminatorMismatch,
}

impl fmt::Display for PetDnaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSeedHash(v) => write!(f, "invalid seedHash {v:?}: expected 64 hex characters"),
            Self::InvalidPubkey(v) => write!(f, "invalid public key {v:?}: expected base58 of 32 bytes"),
            Self::InvalidAmount(v) => write!(f, "invalid SOL amount {v}"),
            Self::UnknownVariant { kind, value } => write!(f, "unknown {kind} {value:?}"),
            Self::NameTooLong { len, max } => write!(f, "name is {len} bytes, max is {max}"),
            Self::MathOverflow => write!(f, "arithmetic overflow"),
            Self::Serialization(msg) => write!(f, "serialization error: {msg}"),
            Self::DiscriminatorMismatch => write!(f, "account discriminator mismatch"),
        }
    }
}

impl std::error::Error for PetDnaError {}

impl From<std::io::Error> for PetDnaError {
    fn from(err: std::io::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, PetDnaError>;
