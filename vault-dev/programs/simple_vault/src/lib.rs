use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

pub mod raydium;
use raydium::*;

declare_id!("EbojNUfh9Jk6dyZaaQAJWofbdnkvdxfQbeAPq6iWoHAu");

/// Задание 1: комиссия на депозит в базисных пунктах (100 bps = 1%).
pub const DEPOSIT_FEE_BPS: u64 = 100;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Комиссия с суммы депозита (округление вниз — в пользу пользователя).
pub fn deposit_fee(amount: u64) -> Result<u64> {
    (amount as u128)
        .checked_mul(DEPOSIT_FEE_BPS as u128)
        .map(|v| v / BPS_DENOMINATOR as u128)
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(error!(VaultError::MathOverflow))
}

#[program]
pub mod simple_vault {
    use super::*;

    /// Создать vault для конкретного SPL-токена.
    /// Создаёт: VaultState PDA, vault_token_account PDA, share_mint PDA.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_tokens = 0;
        vault.total_shares = 0;
        vault.bump = ctx.bumps.vault_state;
        // Задание 1: по умолчанию комиссия уходит админу, сменить — set_fee_wallet
        vault.fee_wallet = ctx.accounts.admin.key();
        // Задание 2: минимальный депозит — 1 целый токен (10^decimals минимальных единиц)
        vault.min_deposit = 10u64
            .checked_pow(ctx.accounts.token_mint.decimals as u32)
            .ok_or(VaultError::MathOverflow)?;
        vault.paused = false;

        msg!("Vault initialized for mint: {}", vault.token_mint);
        Ok(())
    }

    /// Задание 1. Админ меняет кошелёк, на который идёт комиссия 1%.
    pub fn set_fee_wallet(ctx: Context<AdminOnly>, fee_wallet: Pubkey) -> Result<()> {
        ctx.accounts.vault_state.fee_wallet = fee_wallet;
        msg!("Fee wallet: {}", fee_wallet);
        Ok(())
    }

    /// Задание 3. Админ ставит депозиты на паузу (paused = true) или снимает паузу.
    /// Вывод на паузе остаётся доступен: пользователь всегда может забрать свои деньги.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.paused = paused;
        msg!("Vault paused: {}", paused);
        Ok(())
    }

    /// Создать личную «карточку» пользователя в vault.
    /// У каждого пользователя ровно одна карточка (PDA от vault + user).
    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        let card = &mut ctx.accounts.user_card;
        card.vault = ctx.accounts.vault_state.key();
        card.owner = ctx.accounts.user.key();
        card.bump = ctx.bumps.user_card;

        msg!("User card created for: {}", card.owner);
        Ok(())
    }

    /// Пользователь вносит `amount` токенов → получает share-токены.
    ///
    /// Комиссия 1% (задание 1) уходит на `fee_wallet`, shares считаются от остатка `net`:
    ///   net = amount - amount * 1%
    ///   Первый депозит:       shares = net  (1:1)
    ///   Последующие депозиты: shares = net * total_shares / total_tokens
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault_state.in_market, VaultError::InMarket);
        // Задание 3: админ поставил депозиты на паузу
        require!(!ctx.accounts.vault_state.paused, VaultError::VaultPaused);
        // Задание 2: минимальный депозит
        require!(amount >= ctx.accounts.vault_state.min_deposit, VaultError::DepositTooSmall);

        let vault = &ctx.accounts.vault_state;

        // Задание 1: комиссия и сумма, которая реально попадёт в vault
        let fee = deposit_fee(amount)?;
        let net = amount.checked_sub(fee).ok_or(VaultError::MathOverflow)?;

        // Сколько shares получит пользователь
        let shares = if vault.total_shares == 0 || vault.total_tokens == 0 {
            net // первый депозит: 1 share = 1 token
        } else {
            (net as u128)
                .checked_mul(vault.total_shares as u128)
                .and_then(|v| v.checked_div(vault.total_tokens as u128))
                .and_then(|v| u64::try_from(v).ok())
                .ok_or(VaultError::MathOverflow)?
        };
        require!(shares > 0, VaultError::SharesTooSmall);

        // 0. Комиссия: пользователь → fee_wallet
        if fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.user_token_account.to_account_info(),
                        to: ctx.accounts.fee_token_account.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        // 1. Переводим токены: пользователь → vault (уже без комиссии)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net,
        )?;

        // 2. Печатаем shares пользователю (подписывает vault PDA)
        let token_mint_key = ctx.accounts.vault_state.token_mint;
        let seeds = &[
            b"vault".as_ref(),
            token_mint_key.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer,
            ),
            shares,
        )?;

        // 3. Обновляем vault и карточку пользователя
        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_add(net).ok_or(VaultError::MathOverflow)?;
        vault.total_shares = vault.total_shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;

        // В карточку пишем то, что реально легло в vault (без комиссии)
        let card = &mut ctx.accounts.user_card;
        card.deposited = card.deposited.checked_add(net).ok_or(VaultError::MathOverflow)?;
        card.shares = card.shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;

        msg!(
            "Deposit: {} tokens (fee {}) -> {} shares (total_tokens={}, total_shares={})",
            amount, fee, shares, vault.total_tokens, vault.total_shares
        );
        Ok(())
    }

    /// Пользователь возвращает `shares_amount` share-токенов → забирает свои токены.
    ///
    /// Формула: tokens = shares * total_tokens / total_shares
    pub fn withdraw(ctx: Context<Withdraw>, shares_amount: u64) -> Result<()> {
        withdraw_shares(ctx.accounts, shares_amount)
    }

    /// Задание 5. Сжечь все shares пользователя за один вызов.
    /// Сколько их — берём из share-аккаунта на цепочке, а не с клиента.
    pub fn withdraw_all(ctx: Context<Withdraw>) -> Result<()> {
        let all = ctx.accounts.user_share_account.amount;
        withdraw_shares(ctx.accounts, all)
    }

    /// Задание 6. Закрыть карточку, когда shares не осталось: рента возвращается пользователю.
    /// Проверку shares делает `constraint` в `CloseUserCard`, закрытие — `close = user`.
    pub fn close_user_card(ctx: Context<CloseUserCard>) -> Result<()> {
        msg!("User card closed: {}", ctx.accounts.user_card.owner);
        Ok(())
    }

    // ─── Недели 12–13: Raydium CLMM (код в raydium.rs) ──────────────────────

    /// Админ заводит vault второй токен пары (TOKEN_B пула).
    pub fn add_pair_token(ctx: Context<AddPairToken>) -> Result<()> {
        raydium::add_pair_token(ctx)
    }

    /// Неделя 12. Админ обменивает токены vault через пул Raydium.
    pub fn swap<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, VaultSwap<'info>>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        raydium::swap(ctx, amount_in, min_amount_out, a_to_b)
    }

    /// Неделя 13. Админ открывает позицию vault в ценовом диапазоне.
    pub fn open_position<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, VaultOpenPosition<'info>>,
        tick_lower_index: i32,
        tick_upper_index: i32,
        tick_array_lower_start_index: i32,
        tick_array_upper_start_index: i32,
        amount_0_max: u64,
        amount_1_max: u64,
        base_0: bool,
    ) -> Result<()> {
        raydium::open_position(
            ctx,
            tick_lower_index,
            tick_upper_index,
            tick_array_lower_start_index,
            tick_array_upper_start_index,
            amount_0_max,
            amount_1_max,
            base_0,
        )
    }

    /// Задание 8. Админ докладывает токены vault в уже открытую позицию.
    pub fn increase_liquidity<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, VaultPosition<'info>>,
        amount_0_max: u64,
        amount_1_max: u64,
        base_0: bool,
    ) -> Result<()> {
        raydium::increase_liquidity(ctx, amount_0_max, amount_1_max, base_0)
    }

    /// Неделя 13. Админ забирает накопленные комиссии позиции в vault.
    pub fn collect_fees<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, VaultPosition<'info>>,
    ) -> Result<()> {
        raydium::collect_fees(ctx)
    }

    /// Неделя 13. Админ закрывает позицию: всё возвращается в vault.
    pub fn close_position<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, VaultPosition<'info>>,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        raydium::close_position(ctx, amount_0_min, amount_1_min)
    }

    /// Вернуть vault в обычный режим, когда всё снова в TOKEN_A.
    pub fn sync_vault(ctx: Context<SyncVault>) -> Result<()> {
        raydium::sync_vault(ctx)
    }
}

/// Общая логика withdraw и withdraw_all: сжечь `shares_amount` shares и отдать токены.
fn withdraw_shares(accounts: &mut Withdraw, shares_amount: u64) -> Result<()> {
    require!(shares_amount > 0, VaultError::ZeroAmount);
    require!(!accounts.vault_state.in_market, VaultError::InMarket);

    let vault = &accounts.vault_state;
    require!(vault.total_shares > 0, VaultError::VaultEmpty);

    // Сколько токенов положено за эти shares
    let tokens_out = (shares_amount as u128)
        .checked_mul(vault.total_tokens as u128)
        .and_then(|v| v.checked_div(vault.total_shares as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(VaultError::MathOverflow)?;
    require!(tokens_out > 0, VaultError::WithdrawTooSmall);

    // 1. Сжигаем shares пользователя (подписывает сам пользователь)
    token::burn(
        CpiContext::new(
            accounts.token_program.to_account_info(),
            Burn {
                mint: accounts.share_mint.to_account_info(),
                from: accounts.user_share_account.to_account_info(),
                authority: accounts.user.to_account_info(),
            },
        ),
        shares_amount,
    )?;

    // 2. Отправляем токены: vault → пользователь (подписывает vault PDA)
    let token_mint_key = accounts.vault_state.token_mint;
    let seeds = &[
        b"vault".as_ref(),
        token_mint_key.as_ref(),
        &[accounts.vault_state.bump],
    ];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            accounts.token_program.to_account_info(),
            Transfer {
                from: accounts.vault_token_account.to_account_info(),
                to: accounts.user_token_account.to_account_info(),
                authority: accounts.vault_state.to_account_info(),
            },
            signer,
        ),
        tokens_out,
    )?;

    // 3. Обновляем vault и карточку пользователя
    let vault = &mut accounts.vault_state;
    vault.total_tokens = vault.total_tokens.checked_sub(tokens_out).ok_or(VaultError::MathOverflow)?;
    vault.total_shares = vault.total_shares.checked_sub(shares_amount).ok_or(VaultError::MathOverflow)?;

    // saturating: shares можно передать другому кошельку, тогда в карточке их может быть меньше
    let card = &mut accounts.user_card;
    card.deposited = card.deposited.saturating_sub(tokens_out);
    card.shares = card.shares.saturating_sub(shares_amount);

    msg!(
        "Withdraw: {} shares -> {} tokens (total_tokens={}, total_shares={})",
        shares_amount, tokens_out, vault.total_tokens, vault.total_shares
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

/// Инструкции, которые может вызвать только админ vault (set_fee_wallet, set_paused).
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ VaultError::Unauthorized,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
}

/// Задание 6. Закрыть карточку без shares.
#[derive(Accounts)]
pub struct CloseUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Карточка закрывается, рента уходит владельцу
    #[account(
        mut,
        close = user,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
        constraint = user_card.shares == 0 @ VaultError::CardHasShares,
    )]
    pub user_card: Account<'info, UserCard>,

    /// Share-аккаунт пользователя: на нём тоже должно быть 0 shares
    #[account(
        token::mint = vault_state.share_mint,
        token::authority = user,
        constraint = user_share_account.amount == 0 @ VaultError::CardHasShares,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// VaultState PDA — seeds: ["vault", token_mint]
    #[account(
        init,
        payer = admin,
        space = VaultState::LEN,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Token account, принадлежащий vault PDA
    #[account(
        init,
        payer = admin,
        token::mint = token_mint,
        token::authority = vault_state,
        seeds = [b"vault_tokens", token_mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Mint для shares — выпускается vault PDA
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault_state,
        seeds = [b"share_mint", token_mint.key().as_ref()],
        bump,
    )]
    pub share_mint: Account<'info, Mint>,

    /// SPL-токен, который принимает vault
    pub token_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// UserCard PDA — seeds: ["user_card", vault_state, user]
    #[account(
        init,
        payer = user,
        space = UserCard::LEN,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Карточка пользователя — депозит возможен только после create_user_card
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    /// Токен-аккаунт vault — принимает токены
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — vault печатает shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (откуда списываем токены)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (куда придут shares)
    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    /// Задание 1: токен-аккаунт fee_wallet (куда идёт комиссия 1%)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = vault_state.fee_wallet,
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// Карточка пользователя — вывод возможен только с карточкой
    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
    )]
    pub user_card: Account<'info, UserCard>,

    /// Токен-аккаунт vault — отправляет токены пользователю
    #[account(
        mut,
        seeds = [b"vault_tokens", vault_state.token_mint.as_ref()],
        bump,
        token::mint = vault_state.token_mint,
        token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Share mint — тут сжигаются shares
    #[account(
        mut,
        seeds = [b"share_mint", vault_state.token_mint.as_ref()],
        bump,
        mint::authority = vault_state,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Токен-аккаунт пользователя (куда придут токены)
    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Share-аккаунт пользователя (откуда сжигаем shares)
    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct VaultState {
    pub admin: Pubkey,               // 32
    pub token_mint: Pubkey,          // 32 — SPL-токен vault'а
    pub vault_token_account: Pubkey, // 32 — PDA для токенов
    pub share_mint: Pubkey,          // 32 — mint для shares
    pub total_tokens: u64,           // 8  — всего токенов в vault
    pub total_shares: u64,           // 8  — всего выпущено shares
    pub bump: u8,                    // 1
    pub token_mint_b: Pubkey,        // 32 — второй токен пары (неделя 12), default = нет
    pub vault_token_account_b: Pubkey, // 32 — PDA для TOKEN_B
    pub position_nft_mint: Pubkey,   // 32 — NFT открытой позиции (неделя 13), default = нет
    pub in_market: bool,             // 1  — деньги в TOKEN_B/позиции: deposit и withdraw на паузе
    // ─── задания для практики ───
    pub fee_wallet: Pubkey,          // 32 — задание 1: куда идёт комиссия 1% с депозита
    pub min_deposit: u64,            // 8  — задание 2: минимальный депозит (в минимальных единицах)
    pub paused: bool,                // 1  — задание 3: админ остановил депозиты
    pub total_fees_a: u64,           // 8  — задание 9: собрано комиссий Raydium в TOKEN_A за всё время
    pub total_fees_b: u64,           // 8  — задание 9: то же в TOKEN_B
}

impl VaultState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 32 + 32 + 32 + 1 + 32 + 8 + 1 + 8 + 8;
}

/// Карточка пользователя в vault.
#[account]
#[derive(Default)]
pub struct UserCard {
    pub vault: Pubkey, // 32 — к какому vault относится
    pub owner: Pubkey, // 32 — владелец карточки
    pub deposited: u64, // 8 — сколько токенов внёс пользователь
    pub shares: u64,    // 8 — сколько shares у пользователя
    pub bump: u8,      // 1
}

impl UserCard {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Shares would be zero - deposit too small")]
    SharesTooSmall,
    #[msg("Vault is empty")]
    VaultEmpty,
    #[msg("Withdraw amount too small")]
    WithdrawTooSmall,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized: only admin can call this")]
    Unauthorized,
    #[msg("Vault funds are in the market: deposit/withdraw paused until sync_vault")]
    InMarket,
    #[msg("Pair token (TOKEN_B) is not set: call add_pair_token")]
    PairNotSet,
    #[msg("Pair token must differ from vault token")]
    SameToken,
    #[msg("Pool does not match vault token pair")]
    WrongPool,
    #[msg("tick_lower must be less than tick_upper")]
    InvalidTickRange,
    #[msg("Position is already open")]
    PositionAlreadyOpen,
    #[msg("No open position")]
    NoOpenPosition,
    #[msg("Cannot sync: position is still open, call close_position first")]
    PositionOpen,
    #[msg("Cannot sync: vault still holds TOKEN_B, swap it back to TOKEN_A first")]
    TokenBNotZero,
    #[msg("Deposit is below the vault minimum")]
    DepositTooSmall,
    #[msg("Deposits are paused by admin")]
    VaultPaused,
    #[msg("User still has shares: withdraw them before closing the card")]
    CardHasShares,
    #[msg("Swap too large: at most 50% of vault TOKEN_A per swap")]
    SwapTooLarge,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_one_percent_rounded_down() {
        assert_eq!(deposit_fee(100_000_000).unwrap(), 1_000_000); // 100 токенов → 1 токен
        assert_eq!(deposit_fee(1_000_000).unwrap(), 10_000); // 1 токен → 0.01
        assert_eq!(deposit_fee(99).unwrap(), 0); // меньше 100 единиц — комиссия 0
        assert_eq!(deposit_fee(u64::MAX).unwrap(), u64::MAX / 100);
    }

    #[test]
    fn vault_state_len_matches_borsh_size() {
        // 8 байт discriminator + сами поля в Borsh
        let mut bytes = Vec::new();
        AnchorSerialize::serialize(&VaultState::default(), &mut bytes).unwrap();
        assert_eq!(VaultState::LEN, 8 + bytes.len());
    }
}
