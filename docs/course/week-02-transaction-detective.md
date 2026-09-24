# Неделя 2. Как на самом деле работает Solana: Transaction Detective

**Задание (силлабус):** разобрать реальные Solana-транзакции и определить
accounts, instructions и programs. Результат обучения — PO1.

**Что сделано:** инструмент-детектив для любой транзакции и разбор двух
настоящих devnet-транзакций именно тех типов, которые порождает PetNFT:

1. **Оплата минта питомца.** Это `SystemProgram.transfer` на treasury
   (`frontend/src/services/mintPayment.ts`). Разбираем реальный платёж на наш
   treasury-адрес от 23.09.2026.
2. **Минт NFT через Metaplex.** Это `createNft` из umi (`frontend/src/services/nft.ts`).
   Разбираем реальный devnet-минт с той же парой инструкций `CreateV1` + `MintV1`.

## Теория в одном экране

Транзакция = **подписи** + **message**. В message лежат:

- **account keys** — все аккаунты, которые транзакция прочитает или
  изменит. В Solana аккаунт — это всё: кошелёк, программа, данные, токен-счёт.
  Заголовок message помечает каждый аккаунт как `signer` (обязан подписать)
  и/или `writable` (будет изменён). Отсюда параллельность Solana:
  транзакции, не пишущие в одни и те же аккаунты, выполняются одновременно;
- **recent blockhash** — «срок годности» (~1 минута) и защита от повтора;
- **instructions** — список вызовов `(programId, [accounts], data)`,
  которые выполняются по порядку и **атомарно**: если падает одна, откатывается вся транзакция.

Программа во время выполнения может вызвать другую программу: это
**CPI** (cross-program invocation). В RPC-ответе такие вызовы лежат в
`meta.innerInstructions` с `stackHeight`: 1 — верхний уровень, 2 — CPI из
него, 3 — CPI из CPI.

**Комиссия** = 5000 lamports × число подписей + priority fee
(цена за compute unit × **лимит** CU, а не фактически потраченные CU).

## Инструмент

`backend/src/services/txDetectiveService.ts` — чистая функция
`buildTxReport()` поверх `getParsedTransaction`. Что она делает:

- таблица аккаунтов: флаги signer / writable / fee payer / из lookup-таблицы,
  баланс до и после;
- плоское дерево инструкций с путями `3`, `3.1`, `4.1.4` по `stackHeight`;
- декодирование того, что RPC не разбирает сам: Compute Budget, Metaplex
  Token Metadata (по первому байту Borsh-enum, с именами аккаунтов по
  позициям), Anchor-инструкции по дискриминатору `sha256("global:<name>")[..8]`;
- summary: разбор комиссии, SOL-переводы (перевод на `TREASURY_WALLET`
  помечается как оплата минта PetNFT), для Metaplex-минта **пересчёт
  PDA** metadata / master edition / ATA и сверка с тем, что пришло в транзакции;
- изменения токен-балансов.

```bash
cd backend
npm run tx:detect -- <signature>                  # отчёт
npm run tx:detect -- <signature> --logs           # + логи программ
npm run tx:detect -- <signature> --json           # JSON
npm run tx:detect -- <signature> --save tx.json   # сохранить сырую транзакцию
npm run tx:detect -- --file tx.json               # разбор офлайн
npm run tx:detect -- --recent <address>           # найти транзакции адреса
```

Тесты: `backend/tests/txDetective.test.ts` (9 тестов) на сохранённых
копиях обеих транзакций из `backend/tests/fixtures/`.

---

## Разбор 1. Оплата минта PetNFT

`5sfRvTuTNUbegscA2ihz9gM2Pr7fTk4yv5ZsoV9JsbtPWkRNJ72nPuwMDXja6Z575npcpvcyFnsk6ajV4QYo3MiS`
([Explorer](https://explorer.solana.com/tx/5sfRvTuTNUbegscA2ihz9gM2Pr7fTk4yv5ZsoV9JsbtPWkRNJ72nPuwMDXja6Z575npcpvcyFnsk6ajV4QYo3MiS?cluster=devnet))
· slot 503109206 · 2026-09-23 20:00:03 UTC · legacy · 450 CU

### Accounts

| # | Адрес | Флаги | Что это | SOL до → после |
|---|---|---|---|---|
| 0 | `4z89KmKFjvByF1cMo3SjLRyLAQmBZRw9TfbmbkQLwmBf` | signer, writable, fee payer | кошелёк игрока (Phantom) | 3.099840132 → 2.999760132 (**−0.10008**) |
| 1 | `ADB7iuwTCEakyoQ4KPXgWj44nMfCFTeqLkj2TTNJwc7b` | writable | **treasury PetNFT** (`TREASURY_WALLET`) | 0 → 0.1 (**+0.1**) |
| 2 | `11111111111111111111111111111111` | read-only | System Program | — |
| 3 | `ComputeBudget111111111111111111111111111111` | read-only | Compute Budget | — |

### Instructions и programs

| # | Program | Instruction | Данные |
|---|---|---|---|
| 1 | Compute Budget | `SetComputeUnitPrice` | 375 000 microLamports/CU |
| 2 | Compute Budget | `SetComputeUnitLimit` | 200 000 CU |
| 3 | System Program | `transfer` | 100 000 000 lamports: игрок → treasury |

CPI нет: System Program ничего не вызывает.

### Что из этого следует

- **0.1 SOL — это ровно `BASE_PRICE_SOL`**: `calculateMintPrice(0, 0)`
  при нулевом числе минтов даёт базовую цену. Это первый минт в
  истории treasury (у адреса ровно одна транзакция).
- **Compute Budget добавил кошелёк, а не наш код.** `mintPayment.ts` кладёт
  в транзакцию только `transfer`. Phantom перед подписью дописал две
  инструкции priority fee. Итог: комиссия
  `5000 × 1 подпись + ⌈375000 × 200000 / 10⁶⌉ = 5000 + 75000 = 80000` lamports.
  Это в 16 раз больше базовой. Причём цена считается от **лимита** 200 000 CU,
  а перевод потратил **450**. Идея для PetNFT: самим выставлять
  `SetComputeUnitLimit` около 1 000 CU в `mintPayment.ts`, тогда priority fee
  при той же цене за CU упадёт примерно в 200 раз (если кошелёк не
  перепишет инструкции).
- **Именно эти поля читает бэкенд.** `solanaVerifyService.verifyAndConsumeMintPayment`
  ищет payer и treasury в `staticAccountKeys` и сравнивает
  `postBalances − preBalances` по их индексам: у treasury +100 000 000, у payer
  −100 080 000 (перевод плюс комиссия). Нюанс, который видно только при разборе:
  в v0-транзакции treasury может прийти из address lookup table, а не из
  `staticAccountKeys`. Тогда бэкенд отклонит честный платёж. Это безопасно
  (ложный отказ, а не ложное принятие), но стоит знать.
- **Программы — тоже аккаунты.** System Program и Compute Budget стоят в
  списке аккаунтов как read-only: транзакция обязана заранее объявить
  всё, к чему прикоснётся, включая исполняемый код.

---

## Разбор 2. Минт NFT через Metaplex (`createNft`)

`5HaDjnwVHmhP2mbASRMoji6nLFaVfG3aYhD7xB7uWXjTNm1Q8SzaCSJw4mw9dsFawxSb3ir5eMdnvN9tSGZ95Xx1`
([Explorer](https://explorer.solana.com/tx/5HaDjnwVHmhP2mbASRMoji6nLFaVfG3aYhD7xB7uWXjTNm1Q8SzaCSJw4mw9dsFawxSb3ir5eMdnvN9tSGZ95Xx1?cluster=devnet))
· slot 503520387 · 2026-09-24 14:55:46 UTC · **v0** · 146 990 CU

Транзакция не наша: это чужой devnet-минт. Но она собрана тем же
`createNft` из umi, что и кнопка **Mint on Devnet** в PetNFT, то есть та же пара
`CreateV1` + `MintV1`. Разница одна: у нас payer = authority = кошелёк игрока,
поэтому подписей будет 2 (кошелёк + новый mint), а здесь их 3.

### Accounts (13)

| # | Флаги | Роль | SOL до → после |
|---|---|---|---|
| 0 `3wv4Ddx1…` | S W F | payer: платит rent за все новые аккаунты и комиссию | 0.8799 → 0.8629 (**−0.0170559**) |
| 1 `B6JJvDoj…` | S W | **mint** — новый keypair, поэтому подписывает | 0 → 0.0010668 |
| 2 `5JppFzAB…` | S | authority / update authority / владелец NFT | — |
| 3 `AamGJqaM…` | W | **metadata PDA** | 0 → 0.0137338 |
| 4 `A7dAfV8M…` | W | **master edition PDA** | 0 → 0.00075184 |
| 5 `8DpcjcntF…` | W | **token account (ATA)** владельца | 0 → 0.00148844 |
| 6–12 | read-only | Compute Budget, Token Metadata, System, Sysvar Instructions, SPL Token, ATA program, Memo | — |

### Instructions: 5 верхнего уровня и 16 CPI

```
1       Compute Budget          SetComputeUnitPrice   100 microLamports
2       Compute Budget          SetComputeUnitLimit   191 087
3       Token Metadata          CreateV1              (первый байт данных = 42)
  3.1     System                transfer        13 733 800 → metadata PDA (rent)
  3.2     System                createAccount   mint, 82 байта, owner = SPL Token
  3.3     SPL Token             initializeMint2 decimals = 0
  3.4     System                allocate        metadata, 607 байт
  3.5     System                assign          metadata → owner = Token Metadata
  3.6     System                transfer        751 840 → master edition (rent)
  3.7     System                allocate        master edition
  3.8     System                assign          master edition → owner = Token Metadata
  3.9     SPL Token             setAuthority    mintTokens    → master edition PDA
  3.10    SPL Token             setAuthority    freezeAccount → master edition PDA
4       Token Metadata          MintV1                (первый байт = 43)
  4.1     Associated Token      create          ATA владельца
    4.1.1   SPL Token           getAccountDataSize (extension immutableOwner)
    4.1.2   System              createAccount   ATA, owner = SPL Token
    4.1.3   SPL Token           initializeImmutableOwner
    4.1.4   SPL Token           initializeAccount3
  4.2     SPL Token             mintTo          amount = 1, mintAuthority = master edition PDA
5       Memo                    memo            "2m4u9"
```

Программы: System ×8, SPL Token ×7, Token Metadata ×2, Compute Budget ×2, ATA ×1, Memo ×1.

### Проверка PDA (детектив не верит транзакции на слово)

Инструмент сам выводит адреса из seed'ов и сверяет с тем, что пришло в транзакции:

```
OK  metadata        AamGJqaM… == PDA(["metadata", TokenMetadataProgram, mint])
OK  master edition  A7dAfV8M… == PDA(["metadata", TokenMetadataProgram, mint, "edition"])
OK  token account   8DpcjcntF… == PDA([owner, TokenProgram, mint], ATA program)
```

### Что из этого следует

- **NFT — это обычный SPL-токен, который невозможно доминтить.** `decimals = 0`
  (3.3). Затем `setAuthority` (3.9, 3.10) отдаёт права mint и freeze
  **PDA master edition**, у которого нет приватного ключа. Единственный `mintTo` (4.2) подписывает сама
  программа Token Metadata через `invoke_signed`. После этого supply = 1
  навсегда. Именно это отличает NFT от любого другого токена.
- **Почти вся стоимость минта — rent, а не комиссия.** Payer отдал 0.0170559 SOL:
  metadata 0.0137338 + ATA 0.00148844 + mint 0.0010668 + edition 0.00075184 =
  0.01704088 SOL rent плюс 0.00001502 SOL комиссии. Самый дорогой аккаунт —
  metadata (607 байт). Отсюда важная для PetNFT мысль: всё, что мы
  храним on-chain, оплачивается rent за каждый байт. Поэтому игровое
  состояние питомца живёт в БД бэкенда.
- **Вложенность CPI видна по путям.** `4.1.4` — это цепочка Token Metadata → ATA
  program → SPL Token, три уровня стека. Глубина CPI в Solana ограничена,
  поэтому длинные цепочки вызовов между программами — архитектурное ограничение.
- **Аккаунты создаются двумя способами.** `createAccount` (3.2, 4.1.2) — для
  адреса с приватным ключом, поэтому mint подписывает транзакцию. `transfer + allocate +
  assign` (3.4–3.8) — для PDA: подписать за PDA может только программа-владелец seed'ов.
  То же самое мы увидим в неделях 4 и 5.
- **Memo `"2m4u9"`** (инструкция 5) добавлен не `createNft`, а клиентом,
  отправившим транзакцию. Программа Memo просто пишет строку в лог.

## Проверь себя

1. Разберите свою транзакцию: оплатите минт в локально запущенном PetNFT и
   выполните `npm run tx:detect -- <signature>`. Бэкенд должен пометить её
   как `PetNFT mint payment`.
2. Почему `mint` (#1) подписывает транзакцию, а metadata PDA (#3) — нет?
3. Посчитайте priority fee разбора 2 вручную и сверьте с отчётом:
   `⌈100 × 191087 / 10⁶⌉ = 20`, итого `3 × 5000 + 20 = 15020` lamports.
4. После недель 4–5 разберите транзакции своих программ, указав
   `PET_PASSPORT_PROGRAM_ID` / `PET_COUNTER_PROGRAM_ID` в `backend/.env`:
   детектив подпишет их и распознает Anchor-инструкции по дискриминатору.
