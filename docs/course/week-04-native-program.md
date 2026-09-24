# Неделя 4. Первая Solana Program: `pet_passport` (без Anchor)

**Задание (силлабус):** создать и задеплоить первую Solana Program в Devnet.
Результат — PO2.

**Что сделано:** `native/pet_passport` — нативная программа на
`solana-program` 3.x без фреймворков, и клиент `clients/pet-passport.ts`
для Devnet. Anchor появится только на неделе 5. Здесь всё, что он генерирует,
написано руками, чтобы было видно, что на самом деле происходит.

## Зачем PetNFT «паспорт питомца»

Бэкенд генерирует ДНК питомца off-chain и обещает, что она больше не
меняется (README: «DNA питомца не меняется — эволюция это история
прогресса поверх неизменной ДНК»). Сейчас в это обещание приходится верить.
Паспорт делает его проверяемым. Владелец записывает `Pet.dnaHash` в аккаунт,
который может менять только наша программа, а программа запрещает повторную
инициализацию. Кто угодно может прочитать аккаунт и сравнить `dnaHash`
с тем, что отдаёт `GET /api/pets/:id`.

Вторая инструкция, `Feed`, — on-chain счётчик кормлений с кулдауном по часам
кластера (sysvar `Clock`). Это минимальный пример состояния, которое меняется
со временем.

## Устройство программы

```
native/pet_passport/src/
├── lib.rs          entrypoint!(process_instruction) (отключается фичей no-entrypoint)
├── instruction.rs  enum PassportInstruction (Borsh) + билдеры Instruction
├── processor.rs    логика и все проверки аккаунтов; host-тесты
├── state.rs        struct PetPassport (Borsh), LEN = 125 байт
└── error.rs        PassportError → ProgramError::Custom(code)
```

Путь вызова: рантайм → `entrypoint!` → `process_instruction(program_id,
accounts, data)` → из sysvar'ов берутся `Clock` и `Rent` → `process(…, &Env)`.
`Env` передаётся параметром, поэтому ту же логику можно гонять в обычных
`cargo test` на компьютере, где sysvar-syscall'ов нет.

### Данные аккаунта (`PetPassport`, 125 байт)

| Поле | Тип | Байт |
|---|---|---|
| `is_initialized` | bool | 1 — свежий аккаунт заполнен нулями, то есть `false` |
| `owner` | Pubkey | 32 |
| `dna_hash` | [u8; 32] | 32 — `Pet.dnaHash` |
| `name` | String | 4 (u32 LE длина) + до 32 |
| `created_at` | i64 | 8 — unix time из `Clock` |
| `feed_count` | u64 | 8 |
| `last_fed_at` | i64 | 8 |

У нативной программы нет 8-байтового дискриминатора, как у Anchor: формат
данных полностью на нас.

### Данные инструкций (Borsh enum)

| Инструкция | Байты | Accounts |
|---|---|---|
| `CreatePassport { name, dna_hash }` | `[0] ++ u32 LE len(name) ++ name ++ dna_hash(32)` | 0 `[signer]` owner · 1 `[signer, writable]` passport |
| `Feed` | `[1]` | 0 `[signer]` owner · 1 `[writable]` passport |

Клиент кладёт в **одну транзакцию** две инструкции:
`SystemProgram.createAccount` (создать 125 байт, внести rent, передать
владение нашей программе) и `CreatePassport`. Если вторая упадёт,
откатится и первая, и «полусозданного» паспорта не останется.

### Проверки — то, что Anchor потом сделает за нас

| Проверка | Зачем | Ошибка |
|---|---|---|
| owner и passport подписали `CreatePassport` | подпись passport доказывает, что вызывающий держит его keypair: никто не перехватит чужой созданный аккаунт | `MissingRequiredSignature` |
| `passport.owner == program_id` | данные можно доверять, только если аккаунт принадлежит нам | `IncorrectProgramId` |
| `passport.is_writable` | явная ошибка вместо падения рантайма в конце | `AccountNotWritable` (7) |
| `data_len == LEN` | правильный размер | `InvalidAccountData` |
| `rent.is_exempt(lamports, len)` | аккаунт не должен исчезнуть из-за rent | `NotRentExempt` (6) |
| имя 1–32 байта | влезает в `LEN` | `EmptyName` (2), `NameTooLong` (3) |
| `!is_initialized` | **ДНК нельзя перезаписать** | `AlreadyInitialized` (0) |
| `state.owner == signer` в `Feed` | кормить может только владелец | `NotOwner` (4) |
| `now − last_fed_at ≥ 60 с` | кулдаун (в бэкенде 1 час, для демо 60 с) | `FeedCooldown` (5) |
| `feed_count.checked_add(1)` | без переполнения | `MathOverflow` (8) |

## Тесты на хосте

```bash
cd native/pet_passport
cargo test        # 7 тестов
```

Тесты создают настоящие `AccountInfo` в памяти и вызывают `process()`
напрямую. Покрыто: успешное создание, запрет перезаписи ДНК, неподписанный
passport, чужой owner-program, не rent-exempt, пустое и длинное имя, нехватка
аккаунтов, кормление до инициализации, кулдаун, чужой владелец, неподписанный
владелец, мусор вместо данных инструкции, байтовая раскладка инструкций,
`LEN` для максимального паспорта.

## Сборка и деплой в Devnet

Нужны Solana CLI (Agave) и Rust. На Windows удобнее всего через WSL2 (Ubuntu),
инструкция установки: <https://solana.com/docs/intro/installation>.

```bash
# 1. Кошелёк и devnet SOL (деплой стоит примерно 0.5–1.5 SOL за rent программы)
solana config set --url devnet
solana-keygen new                 # ~/.config/solana/id.json
solana airdrop 2                  # или https://faucet.solana.com

# 2. Сборка под SBF и деплой
cd native/pet_passport
cargo build-sbf                   # target/deploy/pet_passport.so + pet_passport-keypair.json
solana program deploy target/deploy/pet_passport.so
# → Program Id: <PROGRAM_ID>

# 3. Взаимодействие (из корня репозитория)
cd ../..
npm install
npm run passport -- create --name Blaze --dna <Pet.dnaHash из бэкенда>
npm run passport -- feed --passport <адрес паспорта>
npm run passport -- feed --passport <адрес паспорта>   # раньше чем через 60 с: pet_passport error: FeedCooldown
npm run passport -- show --passport <адрес паспорта>
```

Клиент берёт program id из `--program`, `PET_PASSPORT_PROGRAM_ID` или из
`native/pet_passport/target/deploy/pet_passport-keypair.json`. Коды ошибок
программы он переводит обратно в имена.

Rent-exempt минимум паспорта на devnet сейчас — 1 285 240 lamports
(≈0.0013 SOL). Его платит `createAccount`.

## Связь с неделей 2

Разберите собственную транзакцию детективом:

```bash
cd backend
PET_PASSPORT_PROGRAM_ID=<PROGRAM_ID> npm run tx:detect -- <signature> --logs
```

Вы увидите 2 инструкции верхнего уровня (`System :: createAccount` и нашу
программу), аккаунт паспорта с флагами `S W` и `+0.00128524 SOL`, а в логах
`Program log: Instruction: CreatePassport`.
