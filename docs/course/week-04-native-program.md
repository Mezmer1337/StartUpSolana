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

## Проверка on-chain (локальный валидатор)

Программа собрана под SBF (`cargo build-sbf`, platform-tools 1.57):
`pet_passport.so` весит **69 568 байт**. Она задеплоена в локальный валидатор
`surfpool` и прогнана клиентом `clients/pet-passport.ts`:

```
$ npm run passport -- create --name Blaze --dna 63126e9e…3309ba
passport   4tVjf2y1pNcfSGXmxunzo4Fch2uRrnDr335WWDCKUji4  (125 bytes, 1760880 lamports rent)
name       Blaze
dnaHash    63126e9e4dd0904cb9e05739d990087a000e2d4d6039ab64925e442a203309ba
feedings   0
$ npm run passport -- feed --passport 4tVjf2y1…
feedings   1
$ npm run passport -- feed --passport 4tVjf2y1…      # через 2 секунды
pet_passport error: FeedCooldown
Program log: Instruction: Feed
Program 2k6jZXKS… failed: custom program error: 0x5
```

То есть инициализация, запись `dnaHash`, счётчик и кулдаун по `Clock`
работают в настоящем рантайме Solana, а не только в host-тестах. Как
повторить на Windows: [windows-toolchain.md](windows-toolchain.md).

## Сборка и деплой в Devnet

Нужны Solana CLI (Agave) и Rust. На Windows можно без WSL, см.
[windows-toolchain.md](windows-toolchain.md).

```bash
# 1. Кошелёк и devnet SOL (rent программы ≈ 0.35 SOL, на время деплоя нужно вдвое больше)
solana config set --url devnet
solana-keygen new                 # ~/.config/solana/id.json
# пополнить: https://faucet.solana.com или перевод из Phantom (Devnet); `solana airdrop` обычно упирается в лимит

# 2. Сборка под SBF и деплой
cd native/pet_passport
cargo build-sbf                   # target/deploy/pet_passport.so + pet_passport-keypair.json
solana program deploy target/deploy/pet_passport.so
# → Program Id: 2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U (наш деплой, см. ниже)

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
(≈0.0013 SOL). Его платит `createAccount`. В локальном валидаторе ставка rent
классическая, поэтому там 1 760 880 lamports.

## Задеплоено в Devnet ✅

| Что | Адрес / подпись |
|---|---|
| Программа `pet_passport` | [`2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U`](https://explorer.solana.com/address/2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U?cluster=devnet) — 69 568 байт, rent 0.354 SOL |
| Деплой | [`4aQFRpum…NVCgR66`](https://explorer.solana.com/tx/4aQFRpumJpkWrKwLS4XTHJk5sey7DXmQJCi8MSeQLgp2cfY5PWLbqrYAei39vgXuA4f6bEk9Jvax9VqGbNVCgR66?cluster=devnet) |
| Паспорт питомца «Blaze» | [`5C7v14juurhN37qX7n6JnRa9kvLA5CEPgwriTqXkdv6K`](https://explorer.solana.com/address/5C7v14juurhN37qX7n6JnRa9kvLA5CEPgwriTqXkdv6K?cluster=devnet) — `dnaHash 63126e9e…3309ba` |
| `CreatePassport` | [`2XFGVH8h…uTAj6u`](https://explorer.solana.com/tx/2XFGVH8hFcfzMjUaptAyvVscJ7w53YTNn9umxEddNpWdHcW152RXRGAK6V3U4Pm2rcWNUVbFjcM7sENEUGuTAj6u?cluster=devnet) |
| `Feed` | [`UbHHfnuJ…vv4Y3`](https://explorer.solana.com/tx/UbHHfnuJXWGaduECexGQcDJQi164MoUjtH3jZ7KGYXSQx3YBa3s9x7mMXCkMGHk6dQKwBL2jBUWEs8UPjVvv4Y3?cluster=devnet) |
| Повторный `Feed` сразу же | отклонён программой: `custom program error: 0x5` = `FeedCooldown` |

Upgrade authority и владелец паспорта — CLI-кошелёк деплоера
`8LNCwYwdz3gW75dGKsZQk7WAPKsGD7Nur5RLy8AWYvf7`.

## Связь с неделей 2

Детектив из недели 2 знает формат нашей программы (`PET_PASSPORT_PROGRAM_ID`
в `backend/.env`) и расшифровывает её инструкции, хотя IDL у нативной
программы нет. Разбор настоящей devnet-транзакции `CreatePassport`:

```
$ npm run tx:detect -- 2XFGVH8h…uTAj6u --logs
ACCOUNTS
   0  8LNCwYwd…AWYvf7  SWF-                              3.17701436 -> 3.17571912 (-0.00129524 SOL)
   1  5C7v14ju…kdv6K   SW--                              0 -> 0.00128524 (+0.00128524 SOL)
   2  11111111…11111   ----  System Program
   3  2k6jZXKS…MNB2U   ----  PetNFT pet_passport (native)
INSTRUCTIONS
  1  System Program :: createAccount   lamports=1285240 space=125 owner=2k6jZXKS…
  2  PetNFT pet_passport (native) :: CreatePassport   name=Blaze  dnaHash=63126e9e…3309ba
       owner     8LNCwYwd…AWYvf7
       passport  5C7v14ju…kdv6K
LOGS
  Program log: Instruction: CreatePassport
  Program log: Passport for Blaze created, owner 8LNCwYwd…AWYvf7
  Program 2k6jZXKS… consumed 9008 of 202850 compute units
```

Эта транзакция сохранена фикстурой `backend/tests/fixtures/tx-passport-create.json`
и покрыта тестом.
