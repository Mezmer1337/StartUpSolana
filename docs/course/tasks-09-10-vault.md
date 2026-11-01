# Задания 9–10. Vault: депозит, share-токены и вывод через CPI

**Задание 9 (РО2):** внести токены в Vault и получить share-токены,
подтверждающие долю пользователя.
**Задание 10 (РО3):** вывод токенов из Vault: сжечь share-токены и вернуть
средства пользователю через PDA.

**Что сделано:**

- Anchor-программа `programs/pet_vault`: один vault на mint (по умолчанию
  PETCOIN, подходит любой SPL Token или Token-2022), инструкции
  `initialize_vault`, `deposit`, `withdraw`;
- share-токен — отдельный mint, mint authority у которого — PDA vault'а.
  Сколько shares у игрока, такая и его доля в пуле;
- вывод — CPI в token program, **подписанный PDA** через
  `CpiContext::new_with_signer`. Приватного ключа у vault нет ни у кого;
- для игры: всё, что приходит в vault сверх депозитов (награды, комиссии
  маркетплейса), автоматически делится между держателями shares;
- CLI `clients/pet-vault.ts`, 12 mocha-тестов `tests/pet-vault.ts`
  (включая PETCOIN с комиссией 1%), 4 Rust-теста математики курса.

## Аккаунты

```
Vault         PDA ["vault",  asset_mint]   asset_mint, share_mint, vault_tokens, статистика, bump
share_mint    PDA ["shares", vault]        decimals = как у asset, mint authority = Vault PDA
vault_tokens  ATA(Vault PDA, asset_mint)   депозиты; owner = Vault PDA
user_shares   ATA(user, share_mint)        создаётся при первом депозите (init_if_needed)
```

Все адреса выводятся из адреса mint, хранить их нигде не нужно
(`clients/pet-vault-math.ts → vaultAddresses`). Для ATA, владелец которого
PDA, нужен `allowOwnerOffCurve = true`: PDA по определению не лежит на кривой
ed25519.

## Курс shares

```
deposit:   shares = assets · (supply + 1000) / (total_assets + 1000)    ↓ округление вниз
withdraw:  assets = shares · (total_assets + 1000) / (supply + 1000)    ↓ округление вниз
```

`total_assets` — живой баланс `vault_tokens`, `supply` — живой supply
share-mint. Оба округления в пользу vault: ни депозит, ни вывод не могут
вытащить из пула больше, чем внесено (тест `rounding_never_favours_the_user`).

**Зачем +1000 («виртуальные» shares и assets).** Без них vault уязвим к
атаке первого депозитора: злоумышленник вносит 1 единицу, затем переводит в
vault напрямую 1000 токенов. Курс становится 1 share = 1000 токенов, и
депозит жертвы в 10 токенов округляется до **0 shares** — её деньги
достаются атакующему. С виртуальными 1000 / 1000 донат почти целиком
«съедается» виртуальными долями, а жертва сохраняет ≥ 90% (на деле ~99.9%)
депозита (тест `inflation_attack_does_not_zero_out_the_victim`). Тот же приём,
что в OpenZeppelin ERC-4626. Цена — несколько ppm «пыли», которая остаётся в
vault после полного вывода.

## Депозит: считаем то, что дошло

```rust
let assets_before = vault_tokens.amount;
transfer_checked(user → vault_tokens, amount)          // CPI, подписывает пользователь
vault_tokens.reload()?;
let received = vault_tokens.amount - assets_before;    // а не amount!
let shares = shares_for_assets(received, assets_before, supply_before)?;
mint_to(share_mint → user_shares, shares)              // CPI, подписывает Vault PDA
```

У PETCOIN комиссия Token-2022 1%: из 100 PET до vault доходит 99. Если бы
shares считались от `amount`, каждый депозит размывал бы остальных держателей
на 1%. Поэтому `reload()` и разница балансов. Защита от проскальзывания:
`min_shares` — если курс изменился между котировкой и исполнением, транзакция
откатывается (`SlippageExceeded`).

## Вывод через CPI с подписью PDA

```rust
burn(user_shares, shares)                              // подписывает пользователь: это его токены
let seeds = &[b"vault", asset_mint.as_ref(), &[vault.bump]];
transfer_checked(vault_tokens → user_tokens, assets)   // CpiContext::new_with_signer(…, &[seeds])
```

Владелец `vault_tokens` — Vault PDA. Подпись PDA не создаётся ключом:
runtime признаёт её, когда программа-владелец PDA передаёт в
`invoke_signed` seeds, из которых этот адрес получается. Сделать это может
только `pet_vault`, поэтому деньги выходят из vault только по правилам
программы: сначала сжечь shares, потом получить свою долю.

Проверки в `#[derive(Accounts)]`:

| Ограничение | От чего защищает |
|---|---|
| `seeds = ["vault", asset_mint]` у `vault` | подмена vault другого mint |
| `has_one = share_mint, vault_tokens` | подсунуть свой «share mint» или свой token account вместо vault (тест: `ConstraintHasOne`) |
| `token::authority = user` у `user_shares` | сжечь чужие shares (тест: `ConstraintTokenOwner`) |
| `token::mint`, `mint::token_program` | смешать SPL Token и Token-2022, чужой mint |
| `min_assets` | вывод по худшему курсу, чем ожидал пользователь |

## Клиент

```bash
anchor build                                # target/idl/pet_vault.json, target/types/pet_vault.ts
npm run vault -- init                       # vault для PETCOIN (по умолчанию devnet PETCOIN)
npm run vault -- deposit --amount 100       # min_shares считается от суммы за вычетом комиссии Token-2022
npm run vault -- reward --amount 10         # прямой перевод в vault: цена share растёт
npm run vault -- show
npm run vault -- withdraw --shares 40 [--slippage 50]      # bps, по умолчанию 0.5%
npm run vault -- withdraw --all
```

`--mint <address>` — vault для любого другого токена.

Прогон в Devnet на настоящем PETCOIN:

```
$ npm run vault -- deposit --amount 100 --slippage 150
total assets  99   share supply 99                    # 1 PET удержан комиссией Token-2022
you           99 shares ≈ 99 tokens · wallet 900

$ npm run vault -- reward --amount 10
total assets  108.9   share supply 99                 # дошло 9.9
1 share       = 1.099998 tokens

$ npm run vault -- withdraw --shares 40 --slippage 150
total assets  64.900041   share supply 59
deposited     99 total · withdrawn 43.999959          # 40 shares × 1.1
you           59 shares ≈ 64.899941 tokens · wallet 933.559959   # 43.999959 − 1% комиссии на выходе
```

## Тесты — `tests/pet-vault.ts`

Каждый прогон создаёт новый mint, а значит, и новый vault, поэтому набор
повторяется в Devnet без очистки.

1. vault, share mint (authority = vault PDA, decimals 6) и token account vault'а созданы;
2. второй `initialize_vault` для того же mint: `already in use`;
3. первый депозит 100 → 100 shares (1:1);
4. 50 токенов наград переводом в vault → игрок покупает по 1.5: 150 токенов → ~100 shares;
5. вывод 40 shares → ~60 токенов (свою часть награды), supply уменьшился, перевод подписан PDA;
6. `min_shares` / `min_assets` выше реального: `SlippageExceeded`;
7. нулевые суммы: `ZeroAmount`; 1 сырая единица при цене 1.5: `ZeroShares`;
8. вывод больше, чем есть shares: `insufficient funds` от token program;
9. чужой share-аккаунт: `ConstraintTokenOwner`;
10. поддельный `vault_tokens`: `ConstraintHasOne`;
11. все выводят всё: supply 0, в vault пыль < 0.001 токена, сумма балансов сходится до единицы;
12. **PETCOIN (Token-2022, 1%)**: депозит 100 → 99 shares; вывод 99 shares → 99 PET, игроку доходит 98.01.

```
$ npm run test:vault
  pet_vault
    ✔ creates the vault: state PDA, share mint PDA and token account owned by the vault PDA
    ✔ allows one vault per mint
    ✔ first deposit mints shares 1:1
    ✔ rewards sent to the vault raise the price of a share
    ✔ withdraw burns shares and pays out through a CPI signed by the vault PDA
    ✔ enforces the caller's minimum on deposit and withdraw (slippage)
    ✔ rejects zero amounts and deposits too small for one share unit
    ✔ cannot withdraw more shares than owned
    ✔ a stranger cannot burn someone else's shares
    ✔ a fake vault token account is refused (has_one)
    ✔ everyone withdraws everything; rounding leaves only dust in the vault
    ✔ PETCOIN (Token-2022, 1% transfer fee): shares are minted for what actually arrived
  12 passing
```

## Что проверено, а что нет

- ✅ `cargo test -p pet_vault`: 4/4 (курс, округление, инфляционная атака).
- ✅ `anchor build`, **12/12 на surfpool** и **12/12 против Devnet** (36 с).
- ✅ **Деплой в Devnet** и живой vault для PETCOIN (таблица ниже).
- ⏳ Во фронтенд vault не выведен — только CLI. Награды в vault игра пока
  не отправляет: это ручная команда `reward`.

### Подвох: деплой в Devnet с `--use-rpc`

`solana program deploy --use-rpc` в Devnet упал на записи буфера
(`Max retries exceeded`: публичный RPC режет частые запросы). Буфер с 1.17 SOL
остался висеть — вернуть: `solana program close <buffer> --bypass-warning`.
Без `--use-rpc` (через TPU) и с `--max-sign-attempts 60` деплой прошёл.
`--use-rpc` нужен только для surfpool (см. [windows-toolchain.md](windows-toolchain.md)).

## Задеплоено в Devnet ✅

| Что | Адрес / подпись |
|---|---|
| Программа `pet_vault` | [`5jNEZk5S3JVBYESfjHQGX53xybUY6XHkc7xmpb2LSAFP`](https://explorer.solana.com/address/5jNEZk5S3JVBYESfjHQGX53xybUY6XHkc7xmpb2LSAFP?cluster=devnet) |
| Деплой | [`qomP3mBk…`](https://explorer.solana.com/tx/qomP3mBkPLxjGQYReN23FHNNbqDbLE3UCNQ5wPAN3jpZm9nvB38EVMoFw3R3s5MSRo2Dj43tvMRzyWWKFW6L1Er?cluster=devnet) |
| Vault PETCOIN | [`AzgYvnvoy3km9WrzbPfsfFHdBEYsgrViCxrfXDZ4S6Dv`](https://explorer.solana.com/address/AzgYvnvoy3km9WrzbPfsfFHdBEYsgrViCxrfXDZ4S6Dv?cluster=devnet) |
| Share mint | [`5WnGpt1ZaUarBhFeCFnBo9NrLgUd9SrXeWwYeNpa5RU7`](https://explorer.solana.com/address/5WnGpt1ZaUarBhFeCFnBo9NrLgUd9SrXeWwYeNpa5RU7?cluster=devnet) |
| `init` | [`5ZWCHJqP…`](https://explorer.solana.com/tx/5ZWCHJqPdQsqnEvsCfbwrjt6vqkHToKdNtkLCuLm3ii71ijyCmJGkbTMwjoyW2g3wDcceQUryDYzCT2xhDUn1cZn?cluster=devnet) |
| `deposit 100` (задание 9) | [`4S79syjF…`](https://explorer.solana.com/tx/4S79syjFZNpaR3Q2rViZazUtRzjaKFVs9b2BfpDuwbTXMQDdX8kzi4eegjkoid4kA5QeJDBkJTESCH2T62jRz9oM?cluster=devnet) |
| `reward 10` | [`xmBWbRM9…`](https://explorer.solana.com/tx/xmBWbRM9FQbH6MC3aBNhbvy32emhDmadQdqKrcLLDjWm71khDb6Ma4cuwE17XEJqracj5ZAJf1VrurXkTMS1qnD?cluster=devnet) |
| `withdraw 40` (задание 10, CPI с подписью PDA) | [`4sR9Beax…`](https://explorer.solana.com/tx/4sR9BeaxMW2fgPMgK8f6DE52Tyqaw4x2CuXVQkaTizDQe3Hpk5GQNC77CpdioEifwuuamXZoH23LySaJGdMqtBQ?cluster=devnet) |
