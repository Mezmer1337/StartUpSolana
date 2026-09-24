# Неделя 5. Anchor Framework: Counter Program `pet_counter`

**Задание (силлабус):** создать Counter Program и взаимодействовать с ней
через client. Результат — PO2.

**Что сделано:**

- `programs/pet_counter` — Anchor-программа «счётчик ухода за питомцем»;
- `clients/pet-counter.ts` — клиент для Devnet на `@anchor-lang/core`;
- `tests/pet-counter.ts` — mocha-тесты (`anchor test`);
- `programs/petnft` переведён на **Anchor 1.2** и тоже проходит IDL-сборку.

## Идея

Уход за питомцем (Feed / Play / Train) в PetNFT живёт в базе данных: всплывающее окно
кошелька на каждое действие убило бы игру. `pet_counter` — это опциональная
проверяемая on-chain версия. У каждого питомца свой счётчик, менять его может
только владелец, читать — кто угодно.

```
CareCounter PDA = find_program_address(["care", owner, pet_id], pet_counter)
```

Адрес счётчика выводится из владельца и `Pet.id` бэкенда (cuid ~25 символов,
лимит seed'а — 32 байта). Клиенту не нужно хранить адрес: он его вычисляет.

| Инструкция | Что делает | Accounts |
|---|---|---|
| `initialize(pet_id)` | создаёт PDA, count = 0 | authority `[signer, mut]` (платит rent), counter `[init]`, system_program |
| `increment` / `decrement` | ±1 через `checked_add` / `checked_sub`, событие `CareCounterChanged` | authority `[signer]`, counter `[mut]` |
| `reset` | count = 0, событие | то же |
| `close_counter` | удаляет аккаунт, rent возвращается владельцу | authority `[signer, mut]`, counter `[mut, close = authority]` |

`CareCounter` = 8 (дискриминатор) + 32 authority + (4 + 32) pet_id + 8 count
+ 8 last_updated_at + 1 bump = **93 байта**, rent на devnet — 1 122 680 lamports.
`#[derive(InitSpace)]` считает эти 85 байт полей сам.

Ошибки (`#[error_code]`, коды с 6000): `InvalidPetId`, `Unauthorized`,
`Overflow`, `Underflow`.

## Native (неделя 4) против Anchor (неделя 5)

| Что | `pet_passport` (руками) | `pet_counter` (Anchor) |
|---|---|---|
| разбор данных инструкции | `borsh::from_slice` + enum с индексами | дискриминатор `sha256("global:increment")[..8]` и аргументы — генерирует `#[program]` |
| порядок аккаунтов | `next_account_info` и комментарии | `#[derive(Accounts)]`, по имени |
| signer / writable | `if !x.is_signer …` | `Signer<'info>`, `#[account(mut)]` |
| владелец аккаунта и тип данных | `passport.owner == program_id`, флаг `is_initialized` | `Account<'info, CareCounter>`: проверка owner и 8-байтового дискриминатора |
| создание аккаунта и rent | клиент вызывает `createAccount`, программа проверяет `is_exempt` | `init, payer, space` — CPI в System Program внутри программы |
| адрес аккаунта | случайный keypair, подпись которого нужна | PDA из `seeds` + `bump`, проверяется при каждом вызове |
| права | `state.owner == signer` | `has_one = authority @ CounterError::Unauthorized` |
| ошибки | `enum` + `impl From<…> for ProgramError` | `#[error_code]` + `require!` |
| клиент | байты руками (`clients/pet-passport.ts`) | IDL, `program.methods.increment()` |
| закрытие аккаунта | не реализовано | `close = authority` |

## Что меняется в Anchor 1.x

Anchor 1.0 (апрель 2026) сломал обратную совместимость с 0.30, на которой был написан `petnft`:

- TS-пакет теперь `@anchor-lang/core`, а не `@coral-xyz/anchor`;
- `new Program(idl, provider)` без аргумента `programId`: адрес берётся из IDL;
- `.accounts()` больше не принимает аккаунты, которые Anchor выводит сам,
  поэтому в клиенте и тестах используется `.accountsPartial()`;
- в `Cargo.toml` программы обязательна фича `idl-build = ["anchor-lang/idl-build"]`
  (у `petnft` её не было, и `anchor build` бы не прошёл);
- секции `[registry]` в `Anchor.toml` больше нет;
- все имена в TS-клиенте в camelCase: `program.account.careCounter`,
  `closeCounter`, событие `careCounterChanged`.

Что изменено в `programs/petnft`: `anchor-lang` 0.30.1 → 1.2.0, фичи из шаблона
Anchor 1.2, в `Rarity` добавлен **`Mythic`**. Бэкенд генерирует 6 уровней
редкости, а программа знала только 5, поэтому MYTHIC-питомца нельзя было
записать. Тест перенесён в `tests/petnft.ts` и теперь проверяет ещё и
`update_pet_level`.

## Сборка, тесты, деплой

Нужны Solana CLI (Agave), Rust и Anchor 1.2 (через `avm`). На Windows — через
WSL2. `Anchor.toml` фиксирует `anchor_version = "1.2.0"`.

```bash
cargo install --git https://github.com/solana-foundation/anchor avm --locked
avm install 1.2.0 && avm use 1.2.0

npm install                                  # @anchor-lang/core, mocha, ts-mocha
anchor build                                 # target/deploy/*.so, target/idl/*.json, target/types/*.ts
anchor keys sync                             # подставить свои program id в declare_id! и Anchor.toml
anchor build                                 # пересобрать с новыми id

anchor test --provider.cluster localnet      # локальный валидатор, tests/pet-counter.ts + tests/petnft.ts
anchor deploy --provider.cluster devnet      # деплой (нужны devnet SOL: solana airdrop 2)
```

Тесты `tests/pet-counter.ts`:

1. `initialize` создаёт PDA с count = 0, правильными authority и pet_id;
2. `increment` ×2 + `decrement` → 1, в логах транзакции ровно одно событие `careCounterChanged` с count = 1;
3. `decrement` на нуле → `Underflow`;
4. пустой `pet_id` → `InvalidPetId`;
5. чужой кошелёк не может менять счётчик → `ConstraintSeeds` (PDA с его ключом не совпадает, до `has_one` дело не доходит);
6. `close_counter` удаляет аккаунт.

## Клиент

```bash
npm run counter -- init  --pet cm1abcdefghijklmnopqrstu     # Pet.id из бэкенда
npm run counter -- inc   --pet cm1abcdefghijklmnopqrstu
npm run counter -- dec   --pet cm1abcdefghijklmnopqrstu
npm run counter -- show  --pet cm1abcdefghijklmnopqrstu
npm run counter -- list                                      # все счётчики кошелька (memcmp по authority, offset 8)
npm run counter -- close --pet cm1abcdefghijklmnopqrstu     # вернуть rent
```

Клиент читает IDL из `target/idl/pet_counter.json`, после каждой транзакции
печатает ссылку на Explorer и события из её логов (`EventParser`), а ошибки
программы показывает по имени (`AnchorError`). Кошелёк —
`~/.config/solana/id.json` или `ANCHOR_WALLET`, RPC — devnet или `SOLANA_RPC_URL`.

## Что проверено без Solana CLI

- `cargo check --workspace`: обе программы на `anchor-lang` 1.2.0 без предупреждений;
- IDL-сборка `cargo test __anchor_private_print_idl --features idl-build` (её
  же запускает `anchor build`) для обеих программ. Она поймала ошибку,
  которая сломала бы `anchor build`: `#[constant]` на `usize` (в IDL нет
  такого типа). Исправлено;
- из полученного IDL сгенерированы TS-типы; `tsc` проходит для
  `clients/*.ts` и `tests/*.ts`;
- офлайн через `@anchor-lang/core`: дискриминаторы всех инструкций,
  кодирование `pet_id`, флаги аккаунтов `initialize`, раскладка `CareCounter`
  (authority на смещении 8, на этом держится `list`), парсинг события `careCounterChanged`.

Не проверено: SBF-сборка, `anchor test` на валидаторе и деплой. Для них нужны
Solana CLI и devnet SOL.
