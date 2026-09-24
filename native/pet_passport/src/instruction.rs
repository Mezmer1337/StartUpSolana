use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Instruction data is a Borsh enum: byte 0 is the variant index, then the
/// variant's fields. The TypeScript client builds the same bytes by hand.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq, Eq)]
pub enum PassportInstruction {
    /// Initialises a passport.
    ///
    /// Accounts:
    /// 0. `[signer]`           owner — recorded as the passport owner
    /// 1. `[signer, writable]` passport — a new account of `PetPassport::LEN`
    ///    bytes, created in the same transaction with
    ///    `SystemProgram.createAccount` and assigned to this program. Its
    ///    signature proves the caller holds the keypair, so nobody can
    ///    front-run and claim a passport account someone else created.
    ///
    /// Data: `[0] ++ u32 LE name length ++ name bytes ++ 32-byte dna_hash`
    CreatePassport { name: String, dna_hash: [u8; 32] },

    /// Records one feeding. Fails if the last one was under
    /// `FEED_COOLDOWN_SECS` ago.
    ///
    /// Accounts:
    /// 0. `[signer]`   owner
    /// 1. `[writable]` passport
    ///
    /// Data: `[1]`
    Feed,
}

impl PassportInstruction {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        borsh::from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)
    }
}

pub fn create_passport(
    program_id: &Pubkey,
    owner: &Pubkey,
    passport: &Pubkey,
    name: String,
    dna_hash: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![AccountMeta::new_readonly(*owner, true), AccountMeta::new(*passport, true)],
        data: borsh::to_vec(&PassportInstruction::CreatePassport { name, dna_hash }).expect("borsh to Vec never fails"),
    }
}

pub fn feed(program_id: &Pubkey, owner: &Pubkey, passport: &Pubkey) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![AccountMeta::new_readonly(*owner, true), AccountMeta::new(*passport, false)],
        data: borsh::to_vec(&PassportInstruction::Feed).expect("borsh to Vec never fails"),
    }
}
