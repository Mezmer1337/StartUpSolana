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

Нужны Solana CLI (Agave), Rust и Anchor 1.2. `Anchor.toml` фиксирует
`anchor_version = "1.2.0"`. На Linux/macOS/WSL:

```bash
cargo install --git https://github.com/solana-foundation/anchor avm --locked
avm install 1.2.0 && avm use 1.2.0

npm install                                  # @anchor-lang/core, mocha, ts-mocha
anchor build                                 # target/deploy/*.so, target/idl/*.json, target/types/*.ts
anchor test --provider.cluster localnet      # локальный валидатор surfpool + tests/*.ts
anchor deploy --provider.cluster devnet      # деплой (нужны devnet SOL)
```

На Windows без WSL `anchor test` целиком не работает: он запускает тесты через
`bash`, а локальный валидатор требует прав на символические ссылки. Рабочая
последовательность — в [windows-toolchain.md](windows-toolchain.md).

Program id в репозитории уже синхронизированы (`anchor keys sync`) с
keypair'ами, из которых программы деплоились:

| Программа | Program id |
|---|---|
| `pet_counter` | `F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P` |
| `petnft` | `nDWNF4Za1PgtFxUBfvfuXf3A6AKrGyq6vu7jwWTRzfJ` |

Keypair'ы лежат в `target/deploy/` и в git не попадают. Если кто-то в команде
захочет задеплоить *свою* копию, ему нужно выполнить `anchor keys sync` у себя.
Тогда адреса поменяются, и их нельзя коммитить поверх общих.

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

## Задеплоено в Devnet ✅

| Что | Адрес / подпись |
|---|---|
| Программа `pet_counter` | [`F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P`](https://explorer.solana.com/address/F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P?cluster=devnet) — 146 056 байт, rent 0.743 SOL |
| Программа `petnft` | [`nDWNF4Za1PgtFxUBfvfuXf3A6AKrGyq6vu7jwWTRzfJ`](https://explorer.solana.com/address/nDWNF4Za1PgtFxUBfvfuXf3A6AKrGyq6vu7jwWTRzfJ?cluster=devnet) — 139 624 байта, rent 0.710 SOL |
| Счётчик ухода демо-питомца `cm1petnftdemo0000000000001` | [`CUCbecNZ5VEECs5N49JKMWhvb1fa8MmGfUeLyzZW9zT8`](https://explorer.solana.com/address/CUCbecNZ5VEECs5N49JKMWhvb1fa8MmGfUeLyzZW9zT8?cluster=devnet) — count = 2 |
| `initialize` | [`3o9ZD7uv…xkwHG7jnA`](https://explorer.solana.com/tx/3o9ZD7uvXNQmNhLs2WuTiTFoUB7xv5L4oUbdywnko8F38hsQSmKMfcMswr2w6m9roFJD37cQXKsMLefxkwHG7jnA?cluster=devnet) |
| `increment` | [`4Wu7o29K…yArkD2ib`](https://explorer.solana.com/tx/4Wu7o29Kdb13iXCGd6XVGXT3bHyShZZDeJtRG5DnKLTkXWDr6BfB76U2XRJ8BeMVU2FSLRabAPywHSYUyArkD2ib?cluster=devnet) — событие `careCounterChanged: count=1` |

**mocha-тесты против Devnet: 7/7** (`ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`).
Клиент в Devnet прошёл `init → inc → inc → dec → inc → list`, счётчик
оставлен живым для проверки.

IDL в сеть не загружен: `anchor deploy` в 1.2 пишет его через программу
Program Metadata и падает с `program not found`. Клиенту и тестам on-chain IDL
не нужен, они берут `target/idl/pet_counter.json`. Детектив из недели 2
распознаёт `increment` по дискриминатору и без IDL (тест на фикстуре
`backend/tests/fixtures/tx-counter-increment.json`).

## Что проверено локально

- `anchor build` (Anchor CLI 1.2.0, platform-tools 1.57): `pet_counter.so`
  146 056 байт, `petnft.so` 139 624 байта, IDL и TS-типы сгенерированы.
  Раньше IDL-сборка поймала ошибку, которая сломала бы `anchor build`:
  `#[constant]` на `usize`, в IDL нет такого типа. Исправлено;
- обе программы задеплоены в локальный валидатор `surfpool`, **mocha-тесты
  7/7** (`tests/pet-counter.ts` 6 + `tests/petnft.ts` 1), два прогона подряд;
- по ходу тесты нашли свою же ошибку: два одинаковых `increment()` подряд
  с одним recent blockhash дают одинаковую подпись, и второй отклоняется
  как `already processed`. Тест теперь ждёт новый blockhash;
- клиент `clients/pet-counter.ts` прогнан на валидаторе целиком:

```
init   → count 0
inc    → event careCounterChanged: count=1
inc    → event careCounterChanged: count=2
dec    → event careCounterChanged: count=1
list   → CUCbecNZ…  pet cm1petnftdemo0000000000001  count 1
reset, dec → pet_counter error Underflow: Counter is already zero
close  → closed, rent refunded
```
