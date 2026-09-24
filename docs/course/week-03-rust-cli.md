# Неделя 3. Rust для Solana-разработчика: CLI `petdna`

**Задание (силлабус):** создать небольшую CLI-программу на Rust с
конструкциями, которые понадобятся в Solana-разработке. Результат — PO2.

**Что сделано:** `crates/petdna` — порт генератора ДНК питомца из
`backend/src/services/dnaService.ts` на Rust, плюс утилиты, которые напрямую
пригодятся on-chain: цена в lamports с checked-арифметикой и
Borsh-раскладка Anchor-аккаунта `PetRecord`.

Главная проверка: Rust-версия выдаёт **тех же питомцев, что и бэкенд**.
Кросс-тест сравнивает `dnaHash` (sha256 от всех признаков) на 210 векторах из
TypeScript, включая редкие ветки с аурой и MYTHIC. Совпадают все, байт в байт.

## Команды

```bash
cd crates/petdna
cargo test                         # 21 unit-тест + кросс-тест с TypeScript
cargo run --release -- --help
```

| Команда | Что делает | Аналог в PetNFT |
|---|---|---|
| `generate --wallet <pubkey> --name <имя> [--timestamp ms] [--nonce hex] [--json]` | seed `wallet:name:timestamp:nonce` → sha256 → ДНК | `POST /api/pets/mint` |
| `from-hash <seedHash> [--json]` | пересчитать ДНК из `Pet.seedHash` | `deriveDnaFromSeedHash` |
| `sample --count N` | распределение редкостей, архетипов и аур | `scripts/calibrate-rarity.ts` |
| `price --total-minted N --minted-last-hour M` | динамическая цена минта в SOL и lamports | `economyService.calculateMintPrice` |
| `sale --price-sol X` | комиссия, роялти и выручка продавца в lamports | `marketplaceService.computeSaleBreakdown` |
| `record --mint … --owner … --name … --pet-type … --rarity …` | байты Anchor-аккаунта `PetRecord` и декодирование обратно | `programs/petnft` |

Пример (тот же питомец, что в TS-векторе `Pet13`, с аурой WATER):

```
$ petdna from-hash 1194d650a752598e2b536583db2cddca4f6e2027a46e4fa3344df5aae3c7964d
seedHash    : 1194d650a752598e2b536583db2cddca4f6e2027a46e4fa3344df5aae3c7964d
dnaHash     : 63126e9e4dd0904cb9e05739d990087a000e2d4d6039ab64925e442a203309ba
archetype   : QUADRUPED
traits      : ears=round eyes=star mouth=beak tail=short legs=claws pattern=solid
body        : width=1.174 height=1.082 size=0.911 headSize=0.862
palette     : splitComplementary (hue 182) #18797d #7d1847 #7d480b
trait score : 20 -> LEGENDARY
aura        : WATER
```

Распределение на 50 000 питомцах (`sample --count 50000`): COMMON 61.96%,
UNCOMMON 26.66%, RARE 7.70%, EPIC 2.51%, LEGENDARY 1.08%, MYTHIC 0.10%, аура у
0.96%. Это близко к целевым ~60/25/10/4/0.9/0.1% из ТЗ.

```
$ petdna record --mint So11111111111111111111111111111111111111112 \
    --owner 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU --name Blaze --pet-type dragon --rarity mythic
discriminator : b4e0d1da9068c3b3
account size  : 121 bytes (PetRecord::SPACE)
account data  : b4e0d1da9068c3b3069b8857…
```

## Rust-конструкции → зачем они в Solana

| Конструкция | Где в `petdna` | Где понадобится on-chain |
|---|---|---|
| `enum` + `match` | `Archetype`, `Socket`, `Rarity`, `Aura` в `catalog.rs` | инструкции программы — это enum (неделя 4), состояние, ошибки |
| трейты, generic-функции | `Weighted` + `weighted_pick<T: Weighted>`; `FromStr` / `Display` для `Pubkey`, `Rarity`, `PetType` | `AccountSerialize`, `Sysvar`, `From<E> for ProgramError` |
| `Result`, `?`, свой тип ошибки | `PetDnaError` + `From<io::Error>` в `error.rs` | `ProgramResult`, `ProgramError::Custom(code)`, `#[error_code]` |
| `Option` | части тела, которых нет у архетипа; аура | необязательные аккаунты, `checked_*` → `Option` |
| владение и заимствование | `&str` / `String`, `&'a [T]` → `&'a T` из `weighted_pick`, `&mut` для слота признака | `AccountInfo<'a>`, `try_borrow_mut_data()` |
| целочисленная арифметика без переполнений | `wrapping_*` в PRNG (`rng.rs`); `checked_mul / checked_sub` для lamports (`economy.rs`) | в программе переполнение — это потерянные или напечатанные из воздуха деньги; release-профиль с `overflow-checks = true` |
| `u64` lamports и basis points вместо `f64` | `sol_to_lamports`, `sale_breakdown`, `apply_bps` | все суммы on-chain хранятся в `u64` lamports |
| `[u8; 32]`, base58 | `Pubkey` на `bs58` | `Pubkey`, seed'ы PDA |
| sha256 | `hash.rs` | дискриминаторы Anchor, PDA (`findProgramAddress` — это sha256) |
| Borsh | `PetRecord` в `record.rs`: дискриминатор `sha256("account:PetRecord")[..8]` + поля по порядку + нулевой хвост до `SPACE` | формат данных аккаунтов и инструкций Anchor и нативных программ |
| модули, `pub`, `#[cfg(test)]` | 8 модулей, unit-тесты в каждом | структура любой программы |

## Детали, на которых легко ошибиться

- **Числа JavaScript vs Rust.** `Math.imul`, `| 0` и `>>> 0` в Mulberry32 — это
  u32-арифметика по модулю 2³². В Rust её надо писать явно через
  `wrapping_add` / `wrapping_mul`, иначе debug-сборка упадёт на переполнении.
- **Порядок случайных бросков.** TS проверяет сокеты в фиксированном порядке
  ears → eyes → mouth → tail → legs → wings → fins → special, а не в том, в
  котором они перечислены у архетипа (у QUADRUPED `legs` стоит раньше `tail`).
  Одна перестановка сдвигает весь поток PRNG. Отсюда `Socket::PICK_ORDER`.
- **`drawsOnThisRng++ > 6`** сравнивает *старое* значение: первый генератор
  отдаёт 7 чисел, каждый следующий — 8.
- **`dnaHash` — sha256 от строки `JSON.stringify`.** Совпасть должна строка
  целиком: порядок ключей (`traits` начинаются с `pattern`) и форма чисел
  (`1.0` печатается как `1`). Поэтому JSON в `dna.rs::canonical_json` собран
  вручную, а не через serde.
- **`toFixed(3)`.** Для чисел в диапазоне [0.8, 1.2] не бывает точной середины
  между двумя трёхзначными значениями, так что `format!("{:.3}")` в Rust и
  `toFixed(3)` в JS округляют одинаково.
- **Borsh без имён полей.** В `PetRecord` важен только порядок и типы полей.
  Перестановка двух полей ломает чтение всех существующих аккаунтов.
  `from_account_data` использует `deserialize`, а не `from_slice`: аккаунт
  выделен под максимальную длину имени, и `from_slice` отверг бы нулевой хвост.

## Обновление векторов

Если меняются каталоги признаков в `backend/src/constants/dna.ts`, нужно
перенести изменения в `crates/petdna/src/catalog.rs` и перегенерировать векторы:

```bash
cd backend && npm run dna:vectors      # пишет crates/petdna/tests/fixtures/dna_vectors.json
cd ../crates/petdna && cargo test
```
