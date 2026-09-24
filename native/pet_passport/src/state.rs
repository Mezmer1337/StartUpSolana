use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{program_error::ProgramError, pubkey::Pubkey};

/// Data stored in a passport account (Borsh, no discriminator — a native
/// program decides its own layout; Anchor would prepend 8 bytes).
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub struct PetPassport {
    /// A fresh account is all zeros, which decodes as `false`.
    pub is_initialized: bool,
    pub owner: Pubkey,
    /// sha256 of the pet's DNA — `Pet.dnaHash` in the backend DB.
    pub dna_hash: [u8; 32],
    pub name: String,
    pub created_at: i64,
    pub feed_count: u64,
    pub last_fed_at: i64,
}

impl PetPassport {
    pub const MAX_NAME_LEN: usize = 32;

    /// is_initialized(1) + owner(32) + dna_hash(32) + name(4 + 32)
    /// + created_at(8) + feed_count(8) + last_fed_at(8) = 125 bytes.
    /// The client allocates exactly this many bytes.
    pub const LEN: usize = 1 + 32 + 32 + (4 + Self::MAX_NAME_LEN) + 8 + 8 + 8;

    /// Reads state from account data. `deserialize` instead of
    /// `borsh::from_slice`: shorter names leave zero padding at the end of
    /// the account, and from_slice would reject those trailing bytes.
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        Self::deserialize(&mut &data[..]).map_err(|_| ProgramError::InvalidAccountData)
    }

    pub fn pack(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        let bytes = borsh::to_vec(self).map_err(|_| ProgramError::InvalidAccountData)?;
        let target = data.get_mut(..bytes.len()).ok_or(ProgramError::AccountDataTooSmall)?;
        target.copy_from_slice(&bytes);
        Ok(())
    }
}
