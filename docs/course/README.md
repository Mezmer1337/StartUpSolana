# Курс Solana: недели 2–6 на примере PetNFT

Задания недель 2–6 из силлабуса, выполненные на нашем проекте PetNFT, а не
на абстрактных примерах. Каждая неделя — рабочий код в репозитории плюс
разбор в отдельном файле.

| Неделя | Тема (силлабус) | Задание | Что сделано в PetNFT | Где |
|---|---|---|---|---|
| 2 | Как на самом деле работает Solana | Transaction Detective: разобрать реальные транзакции, определить accounts, instructions, programs | Инструмент-детектив и разбор двух **настоящих devnet-транзакций**: оплаты минта PetNFT на наш treasury и Metaplex-минта NFT (`createNft`) | [week-02](week-02-transaction-detective.md), `backend/src/services/txDetectiveService.ts`, `backend/scripts/tx-detective.ts` |
| 3 | Rust для Solana-разработчика | Небольшая CLI-программа на Rust с конструкциями, нужными в Solana | CLI `petdna`: порт генератора ДНК питомца с TS на Rust, **байт-в-байт совпадающий с бэкендом**; цена минта в lamports с checked math; Borsh-раскладка Anchor-аккаунта `PetRecord` | [week-03](week-03-rust-cli.md), `crates/petdna/` |
| 4 | Первая Solana Program | Создать и задеплоить первую программу в Devnet | Нативная программа `pet_passport` без Anchor: записывает `dnaHash` питомца в блокчейн без возможности перезаписи и ведёт счётчик кормлений с кулдауном по `Clock`. Клиент для Devnet | [week-04](week-04-native-program.md), `native/pet_passport/`, `clients/pet-passport.ts` |
| 5 | Anchor Framework | Counter Program и взаимодействие через client | Anchor-программа `pet_counter`: счётчик ухода за питомцем (PDA на пару владелец + питомец), события, ошибки, закрытие аккаунта; TS-клиент и mocha-тесты. Заодно `programs/petnft` переведён на Anchor 1.2 | [week-05](week-05-anchor-counter.md), `programs/pet_counter/`, `clients/pet-counter.ts`, `tests/` |
| 6 | Accounts, PDAs и архитектура программ | Децентрализованный on-chain профиль с PDA | Программа `player_profile`: профиль в PDA `["profile", wallet]`, уникальные ники через PDA `["username", ник]`, закреплённый питомец — проверенный `PetRecord` программы `petnft`. Клиент, блок **On-chain profile** в интерфейсе, карта аккаунтов всего проекта | [week-06](week-06-pda-profile.md), `programs/player_profile/`, `clients/player-profile.ts`, `frontend/src/components/OnchainProfileCard.tsx` |

## Что проверено, а что нет

- **Неделя 2:** инструмент запускался против devnet RPC на реальных
  транзакциях; 9 unit-тестов на сохранённых копиях этих транзакций
  (`backend/tests/fixtures/`).
- **Неделя 3:** `cargo test` проходит (22 теста). Кросс-тест сверяет Rust с
  TypeScript на 210 векторах, включая ауры и MYTHIC: `dnaHash` совпадает
  байт-в-байт.
- **Неделя 4:** 7 host-тестов логики, SBF-сборка (`pet_passport.so`, 69.5 КБ),
  **деплой в Devnet** ([`2k6jZXKS…MNB2U`](https://explorer.solana.com/address/2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U?cluster=devnet))
  и прогон клиента там: паспорт питомца создан, кормление записано,
  повторное кормление отклонено программой (`FeedCooldown`).
- **Неделя 5:** `anchor build`, **деплой в Devnet** `pet_counter`
  ([`F2msfiA9…PEZ8P`](https://explorer.solana.com/address/F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P?cluster=devnet))
  и `petnft`, **mocha-тесты 7/7 против Devnet** (и против локального
  валидатора), клиент прошёл `init/inc/dec/list`, живой счётчик оставлен в сети.
- **Неделя 6:** `player_profile` **в Devnet**
  ([`CP6Fmq98…nYkB`](https://explorer.solana.com/address/CP6Fmq98dsLrpev7EjEVvuGQ1z2aG9H7vAuDiRPDnYkB?cluster=devnet)),
  10 новых тестов — все **17/17 против Devnet** и локально. Демо-профиль
  `@petnft_demo` с закреплённым питомцем из `petnft`; профиль `@ui_test_pet`
  создан и отредактирован прямо из интерфейса PetNFT.

Всё собрано и запущено на Windows без WSL, инструкция и найденные подвохи —
в [windows-toolchain.md](windows-toolchain.md). Адреса и подписи транзакций —
в файлах недель 4 и 5.

## Быстрый старт

```bash
# Неделя 2: разобрать любую devnet-транзакцию
cd backend && npm install && npm run tx:detect -- <signature> --logs

# Неделя 3: Rust CLI
cd crates/petdna && cargo test && cargo run --release -- sample --count 50000

# Неделя 4: нативная программа (host-тесты, SBF-сборка; деплой — см. week-04)
cd native/pet_passport && cargo test && cargo build-sbf

# Неделя 5: Anchor (Linux/macOS/WSL; на Windows — windows-toolchain.md)
npm install && anchor build && anchor test --provider.cluster localnet
```
