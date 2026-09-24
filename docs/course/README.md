# Курс Solana: недели 2–5 на примере PetNFT

Задания недель 2–5 из силлабуса, выполненные на нашем проекте PetNFT, а не
на абстрактных примерах. Каждая неделя — рабочий код в репозитории плюс
разбор в отдельном файле.

| Неделя | Тема (силлабус) | Задание | Что сделано в PetNFT | Где |
|---|---|---|---|---|
| 2 | Как на самом деле работает Solana | Transaction Detective: разобрать реальные транзакции, определить accounts, instructions, programs | Инструмент-детектив и разбор двух **настоящих devnet-транзакций**: оплаты минта PetNFT на наш treasury и Metaplex-минта NFT (`createNft`) | [week-02](week-02-transaction-detective.md), `backend/src/services/txDetectiveService.ts`, `backend/scripts/tx-detective.ts` |
| 3 | Rust для Solana-разработчика | Небольшая CLI-программа на Rust с конструкциями, нужными в Solana | CLI `petdna`: порт генератора ДНК питомца с TS на Rust, **байт-в-байт совпадающий с бэкендом**; цена минта в lamports с checked math; Borsh-раскладка Anchor-аккаунта `PetRecord` | [week-03](week-03-rust-cli.md), `crates/petdna/` |
| 4 | Первая Solana Program | Создать и задеплоить первую программу в Devnet | Нативная программа `pet_passport` без Anchor: записывает `dnaHash` питомца в блокчейн без возможности перезаписи и ведёт счётчик кормлений с кулдауном по `Clock`. Клиент для Devnet | [week-04](week-04-native-program.md), `native/pet_passport/`, `clients/pet-passport.ts` |
| 5 | Anchor Framework | Counter Program и взаимодействие через client | Anchor-программа `pet_counter`: счётчик ухода за питомцем (PDA на пару владелец + питомец), события, ошибки, закрытие аккаунта; TS-клиент и mocha-тесты. Заодно `programs/petnft` переведён на Anchor 1.2 | [week-05](week-05-anchor-counter.md), `programs/pet_counter/`, `clients/pet-counter.ts`, `tests/` |

## Что проверено, а что нет

Все недели проверены настолько, насколько это возможно без Solana CLI:

- **Неделя 2:** инструмент запускался против devnet RPC на реальных
  транзакциях; 9 unit-тестов на сохранённых копиях этих транзакций
  (`backend/tests/fixtures/`). Все тесты бэкенда: 26/26.
- **Неделя 3:** `cargo test` проходит (22 теста). Кросс-тест сверяет Rust с
  TypeScript на 210 векторах, включая ауры и MYTHIC: `dnaHash` совпадает
  байт-в-байт.
- **Неделя 4:** логика программы протестирована на хосте (7 тестов):
  signer / owner / writable, rent-exempt, повторная инициализация,
  кулдаун, чужой владелец, раскладка байтов инструкций.
- **Неделя 5:** обе Anchor-программы компилируются на Anchor 1.2 (`cargo check`)
  и проходят IDL-сборку (`--features idl-build`, тот же шаг, что делает
  `anchor build`). Эта сборка нашла ошибку: `#[constant]` с типом `usize`, она исправлена.
  TS-клиент и тесты проходят `tsc` против сгенерированных из IDL типов.
  Кодирование инструкций, аккаунта и событий проверено офлайн.

**Не сделано здесь**, потому что на машине разработки нет Solana CLI:
SBF-сборка (`cargo build-sbf` / `anchor build`), деплой в Devnet и прогон
`anchor test` на валидаторе. Точные команды — в файлах недель 4 и 5.
Деплой делается с вашего кошелька и за ваши devnet SOL.

## Быстрый старт

```bash
# Неделя 2: разобрать любую devnet-транзакцию
cd backend && npm install && npm run tx:detect -- <signature> --logs

# Неделя 3: Rust CLI
cd crates/petdna && cargo test && cargo run --release -- sample --count 50000

# Неделя 4: нативная программа (тесты на хосте, затем сборка и деплой, см. week-04)
cd native/pet_passport && cargo test

# Неделя 5: Anchor (нужны Solana CLI + Anchor 1.2, см. week-05)
npm install && anchor build && anchor test --provider.cluster localnet
```
