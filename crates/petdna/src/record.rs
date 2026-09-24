//! The on-chain `PetRecord` account from programs/petnft, byte for byte.
//!
//! An Anchor account is stored as:
//!   [ 8-byte discriminator = sha256("account:PetRecord")[..8] ][ borsh(fields) ][ zero padding up to SPACE ]
//! This module rebuilds that layout off-chain, which is exactly what a
//! client does when it decodes account data fetched over RPC.

use std::fmt;
use std::str::FromStr;

use borsh::{BorshDeserialize, BorshSerialize};

use crate::catalog::Rarity;
use crate::error::{PetDnaError, Result};
use crate::hash::sha256;

/// A 32-byte Ed25519 public key, shown as base58 — same idea as `solana_pubkey::Pubkey`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, BorshSerialize, BorshDeserialize)]
pub struct Pubkey(pub [u8; 32]);

impl FromStr for Pubkey {
    type Err = PetDnaError;

    fn from_str(s: &str) -> Result<Self> {
        let bytes = bs58::decode(s).into_vec().map_err(|_| PetDnaError::InvalidPubkey(s.to_string()))?;
        let array: [u8; 32] = bytes.try_into().map_err(|_| PetDnaError::InvalidPubkey(s.to_string()))?;
        Ok(Pubkey(array))
    }
}

impl fmt::Display for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&bs58::encode(self.0).into_string())
    }
}

impl fmt::Debug for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Pubkey({self})")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum PetType {
    Cat,
    Dog,
    Fox,
    Dragon,
}

impl FromStr for PetType {
    type Err = PetDnaError;

    fn from_str(s: &str) -> Result<Self> {
        match s.to_ascii_lowercase().as_str() {
            "cat" => Ok(PetType::Cat),
            "dog" => Ok(PetType::Dog),
            "fox" => Ok(PetType::Fox),
            "dragon" => Ok(PetType::Dragon),
            _ => Err(PetDnaError::UnknownVariant { kind: "pet type", value: s.to_string() }),
        }
    }
}

/// Field order and types must match `pub struct PetRecord` in
/// programs/petnft/src/lib.rs — borsh has no field names, only positions.
#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
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

    /// discriminator(8) + mint(32) + owner(32) + name(4 + MAX_NAME_LEN)
    /// + pet_type(1) + rarity(1) + level(2) + created_at(8) + bump(1)
    pub const SPACE: usize = 8 + 32 + 32 + (4 + Self::MAX_NAME_LEN) + 1 + 1 + 2 + 8 + 1;

    pub fn discriminator() -> [u8; 8] {
        let hash = sha256(b"account:PetRecord");
        let mut out = [0u8; 8];
        out.copy_from_slice(&hash[..8]);
        out
    }

    /// Account data exactly as Anchor would store it (padded to SPACE).
    pub fn to_account_data(&self) -> Result<Vec<u8>> {
        if self.name.len() > Self::MAX_NAME_LEN {
            return Err(PetDnaError::NameTooLong { len: self.name.len(), max: Self::MAX_NAME_LEN });
        }
        let mut data = Self::discriminator().to_vec();
        data.extend(borsh::to_vec(self)?);
        data.resize(Self::SPACE, 0);
        Ok(data)
    }

    pub fn from_account_data(data: &[u8]) -> Result<Self> {
        let (disc, mut body) = data.split_at_checked(8).ok_or(PetDnaError::DiscriminatorMismatch)?;
        if disc != Self::discriminator() {
            return Err(PetDnaError::DiscriminatorMismatch);
        }
        // `deserialize` (not `borsh::from_slice`) on purpose: the account is
        // padded with zeros up to SPACE, and from_slice rejects trailing bytes.
        Ok(PetRecord::deserialize(&mut body)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str) -> PetRecord {
        PetRecord {
            mint: "So11111111111111111111111111111111111111112".parse().unwrap(),
            owner: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU".parse().unwrap(),
            name: name.to_string(),
            pet_type: PetType::Dragon,
            rarity: Rarity::Mythic,
            level: 7,
            created_at: 1_758_000_000,
            bump: 254,
        }
    }

    #[test]
    fn round_trips_through_account_data() {
        let record = sample("Blaze");
        let data = record.to_account_data().unwrap();
        assert_eq!(data.len(), PetRecord::SPACE);
        assert_eq!(PetRecord::from_account_data(&data).unwrap(), record);
    }

    #[test]
    fn longest_name_fits_exactly_in_space() {
        let data = sample(&"x".repeat(32)).to_account_data().unwrap();
        assert_eq!(data.len(), PetRecord::SPACE);
        assert_eq!(*data.last().unwrap(), 254, "bump is the very last byte when the name is max length");
        assert!(sample(&"x".repeat(33)).to_account_data().is_err());
    }

    #[test]
    fn borsh_layout_is_positional() {
        let data = sample("Blaze").to_account_data().unwrap();
        // 8 disc + 32 mint + 32 owner, then u32 LE string length.
        assert_eq!(&data[72..76], &5u32.to_le_bytes());
        assert_eq!(&data[76..81], b"Blaze");
        assert_eq!(data[81], 3, "PetType::Dragon is variant index 3");
        assert_eq!(data[82], 5, "Rarity::Mythic is variant index 5");
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let mut data = sample("Blaze").to_account_data().unwrap();
        data[0] ^= 0xff;
        assert_eq!(PetRecord::from_account_data(&data), Err(PetDnaError::DiscriminatorMismatch));
    }

    #[test]
    fn pubkey_base58_round_trip_and_validation() {
        let key: Pubkey = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU".parse().unwrap();
        assert_eq!(key.to_string(), "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
        assert!("not-base58!".parse::<Pubkey>().is_err());
        assert!("abc".parse::<Pubkey>().is_err(), "valid base58 but not 32 bytes");
    }
}
