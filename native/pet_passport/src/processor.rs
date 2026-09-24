use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

use crate::{error::PassportError, instruction::PassportInstruction, state::PetPassport};

/// Minimum time between two feedings. The backend's off-chain cooldown is
/// 1 hour; 60 s keeps the devnet demo quick.
pub const FEED_COOLDOWN_SECS: i64 = 60;

/// Values the program reads from sysvars. Passed in explicitly so the
/// instruction logic can be unit-tested on the host, where sysvar
/// syscalls don't exist.
pub struct Env {
    pub now: i64,
    pub rent: Rent,
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let env = Env { now: Clock::get()?.unix_timestamp, rent: Rent::get()? };
    process(program_id, accounts, data, &env)
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8], env: &Env) -> ProgramResult {
    match PassportInstruction::unpack(data)? {
        PassportInstruction::CreatePassport { name, dna_hash } => {
            msg!("Instruction: CreatePassport");
            create_passport(program_id, accounts, name, dna_hash, env)
        }
        PassportInstruction::Feed => {
            msg!("Instruction: Feed");
            feed(program_id, accounts, env)
        }
    }
}

/// Checks shared by every instruction that touches a passport account.
fn check_passport_account(program_id: &Pubkey, passport: &AccountInfo) -> ProgramResult {
    // Only accounts owned by this program can hold (trusted) passport data.
    if passport.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    if !passport.is_writable {
        return Err(PassportError::AccountNotWritable.into());
    }
    Ok(())
}

fn create_passport(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    name: String,
    dna_hash: [u8; 32],
    env: &Env,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let owner = next_account_info(accounts_iter)?;
    let passport = next_account_info(accounts_iter)?;

    if !owner.is_signer || !passport.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    check_passport_account(program_id, passport)?;
    if passport.data_len() != PetPassport::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    if !env.rent.is_exempt(passport.lamports(), passport.data_len()) {
        return Err(PassportError::NotRentExempt.into());
    }
    if name.is_empty() {
        return Err(PassportError::EmptyName.into());
    }
    if name.len() > PetPassport::MAX_NAME_LEN {
        return Err(PassportError::NameTooLong.into());
    }

    let existing = PetPassport::unpack(&passport.try_borrow_data()?)?;
    if existing.is_initialized {
        return Err(PassportError::AlreadyInitialized.into());
    }

    let state = PetPassport {
        is_initialized: true,
        owner: *owner.key,
        dna_hash,
        name,
        created_at: env.now,
        feed_count: 0,
        last_fed_at: 0,
    };
    state.pack(&mut passport.try_borrow_mut_data()?)?;

    msg!("Passport for {} created, owner {}", state.name, state.owner);
    Ok(())
}

fn feed(program_id: &Pubkey, accounts: &[AccountInfo], env: &Env) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let owner = next_account_info(accounts_iter)?;
    let passport = next_account_info(accounts_iter)?;

    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    check_passport_account(program_id, passport)?;

    let mut state = PetPassport::unpack(&passport.try_borrow_data()?)?;
    if !state.is_initialized {
        return Err(PassportError::NotInitialized.into());
    }
    if state.owner != *owner.key {
        return Err(PassportError::NotOwner.into());
    }
    if state.feed_count > 0 && env.now.saturating_sub(state.last_fed_at) < FEED_COOLDOWN_SECS {
        return Err(PassportError::FeedCooldown.into());
    }

    state.feed_count = state.feed_count.checked_add(1).ok_or(PassportError::MathOverflow)?;
    state.last_fed_at = env.now;
    state.pack(&mut passport.try_borrow_mut_data()?)?;

    msg!("{} fed, total feedings: {}", state.name, state.feed_count);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruction::PassportInstruction;

    const NOW: i64 = 1_758_000_000;
    const DNA: [u8; 32] = [7u8; 32];

    fn env(now: i64) -> Env {
        Env { now, rent: Rent::default() }
    }

    /// Owns the memory an AccountInfo borrows from.
    struct TestAccount {
        key: Pubkey,
        lamports: u64,
        data: Vec<u8>,
        owner: Pubkey,
        is_signer: bool,
        is_writable: bool,
    }

    impl TestAccount {
        fn wallet() -> Self {
            Self {
                key: Pubkey::new_unique(),
                lamports: 1_000_000_000,
                data: vec![],
                // Wallets are owned by the System Program, whose id is 32 zero bytes.
                owner: Pubkey::default(),
                is_signer: true,
                is_writable: false,
            }
        }

        fn passport(program_id: &Pubkey) -> Self {
            Self {
                key: Pubkey::new_unique(),
                lamports: Rent::default().minimum_balance(PetPassport::LEN),
                data: vec![0; PetPassport::LEN],
                owner: *program_id,
                is_signer: true,
                is_writable: true,
            }
        }

        fn info(&mut self) -> AccountInfo<'_> {
            AccountInfo::new(
                &self.key,
                self.is_signer,
                self.is_writable,
                &mut self.lamports,
                &mut self.data,
                &self.owner,
                false,
            )
        }
    }

    fn run(program_id: &Pubkey, accounts: &mut [&mut TestAccount], ix: &PassportInstruction, now: i64) -> ProgramResult {
        let data = borsh::to_vec(ix).unwrap();
        let infos: Vec<AccountInfo> = accounts.iter_mut().map(|a| a.info()).collect();
        process(program_id, &infos, &data, &env(now))
    }

    fn create_ix(name: &str) -> PassportInstruction {
        PassportInstruction::CreatePassport { name: name.to_string(), dna_hash: DNA }
    }

    fn custom(err: PassportError) -> ProgramResult {
        Err(ProgramError::Custom(err as u32))
    }

    #[test]
    fn instruction_bytes_match_the_documented_layout() {
        let bytes = borsh::to_vec(&create_ix("Blaze")).unwrap();
        assert_eq!(bytes[0], 0, "variant index");
        assert_eq!(&bytes[1..5], &5u32.to_le_bytes());
        assert_eq!(&bytes[5..10], b"Blaze");
        assert_eq!(&bytes[10..], &DNA);
        assert_eq!(borsh::to_vec(&PassportInstruction::Feed).unwrap(), vec![1]);
    }

    #[test]
    fn max_length_passport_fits_len_exactly() {
        let state = PetPassport {
            is_initialized: true,
            owner: Pubkey::new_unique(),
            dna_hash: DNA,
            name: "x".repeat(PetPassport::MAX_NAME_LEN),
            created_at: NOW,
            feed_count: u64::MAX,
            last_fed_at: NOW,
        };
        assert_eq!(borsh::to_vec(&state).unwrap().len(), PetPassport::LEN);
    }

    #[test]
    fn creates_a_passport() {
        let program_id = Pubkey::new_unique();
        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));

        run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW).unwrap();

        let state = PetPassport::unpack(&passport.data).unwrap();
        assert!(state.is_initialized);
        assert_eq!(state.owner, owner.key);
        assert_eq!(state.dna_hash, DNA);
        assert_eq!(state.name, "Blaze");
        assert_eq!(state.created_at, NOW);
        assert_eq!(state.feed_count, 0);
    }

    #[test]
    fn dna_can_never_be_overwritten() {
        let program_id = Pubkey::new_unique();
        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW).unwrap();

        let again = PassportInstruction::CreatePassport { name: "Evil".into(), dna_hash: [0; 32] };
        assert_eq!(run(&program_id, &mut [&mut owner, &mut passport], &again, NOW), custom(PassportError::AlreadyInitialized));
        assert_eq!(PetPassport::unpack(&passport.data).unwrap().dna_hash, DNA);
    }

    #[test]
    fn create_rejects_bad_accounts_and_names() {
        let program_id = Pubkey::new_unique();

        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        passport.is_signer = false;
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW),
            Err(ProgramError::MissingRequiredSignature)
        );

        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&Pubkey::new_unique()));
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW),
            Err(ProgramError::IncorrectProgramId)
        );

        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        passport.lamports = 1;
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW),
            custom(PassportError::NotRentExempt)
        );

        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        let long = "x".repeat(PetPassport::MAX_NAME_LEN + 1);
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &create_ix(&long), NOW),
            custom(PassportError::NameTooLong)
        );
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &create_ix(""), NOW),
            custom(PassportError::EmptyName)
        );

        let mut owner = TestAccount::wallet();
        assert_eq!(run(&program_id, &mut [&mut owner], &create_ix("Blaze"), NOW), Err(ProgramError::NotEnoughAccountKeys));
    }

    #[test]
    fn feed_enforces_owner_and_cooldown() {
        let program_id = Pubkey::new_unique();
        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        let feed = PassportInstruction::Feed;

        assert_eq!(run(&program_id, &mut [&mut owner, &mut passport], &feed, NOW), custom(PassportError::NotInitialized));

        run(&program_id, &mut [&mut owner, &mut passport], &create_ix("Blaze"), NOW).unwrap();
        run(&program_id, &mut [&mut owner, &mut passport], &feed, NOW + 1).unwrap();
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &feed, NOW + 30),
            custom(PassportError::FeedCooldown)
        );
        run(&program_id, &mut [&mut owner, &mut passport], &feed, NOW + 1 + FEED_COOLDOWN_SECS).unwrap();

        let state = PetPassport::unpack(&passport.data).unwrap();
        assert_eq!(state.feed_count, 2);
        assert_eq!(state.last_fed_at, NOW + 1 + FEED_COOLDOWN_SECS);

        let mut stranger = TestAccount::wallet();
        assert_eq!(
            run(&program_id, &mut [&mut stranger, &mut passport], &feed, NOW + 1000),
            custom(PassportError::NotOwner)
        );

        owner.is_signer = false;
        assert_eq!(
            run(&program_id, &mut [&mut owner, &mut passport], &feed, NOW + 1000),
            Err(ProgramError::MissingRequiredSignature)
        );
    }

    #[test]
    fn rejects_unknown_instruction_data() {
        let program_id = Pubkey::new_unique();
        let (mut owner, mut passport) = (TestAccount::wallet(), TestAccount::passport(&program_id));
        let infos = [owner.info(), passport.info()];
        assert_eq!(process(&program_id, &infos, &[9], &env(NOW)), Err(ProgramError::InvalidInstructionData));
    }
}
