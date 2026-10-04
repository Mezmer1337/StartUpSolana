# Неделя 7. SPL Tokens и Token Extensions: PETCOIN

**Задание (силлабус):** создать собственный токен: выпуск, transfer, metadata и
взаимодействие через client. Результат — PO2.

**Что сделано:**

- **PETCOIN (`PET`)**, внутриигровая валюта PetNFT, теперь существует как
  настоящий токен **Token-2022**. Раньше это было только поле `petCoins` в базе
  бэкенда;
- на mint включены три расширения: **TransferFeeConfig** (комиссия 1%,
  не больше 5 PET за перевод), **MetadataPointer** и **TokenMetadata**
  (имя, символ, uri и свои поля хранятся прямо в mint-аккаунте, без Metaplex);
- общий модуль `clients/petcoin-core.ts` и CLI-клиент `clients/petcoin.ts`:
  выпуск, mint, transfer, баланс, держатели, изменение метаданных, сбор
  комиссий, burn;
- 12 тестов `tests/petcoin.ts`, включая 4 негативных с точными кодами ошибок;
- off-chain JSON токена: `frontend/public/petcoin/metadata.json` и иконка
  `petcoin.svg`.

## SPL Token против Token-2022

| | SPL Token (`Tokenkeg…`) | Token-2022 (`TokenzQd…`) |
|---|---|---|
| Mint | 82 байта, фиксированная раскладка | 82 байта + `AccountType` + TLV-расширения |
| Метаданные | только через отдельную программу (Metaplex Token Metadata, PDA) | расширение `TokenMetadata` прямо в mint |
| Комиссия за перевод | невозможна без своей программы | расширение `TransferFeeConfig` |
| Совместимость | все кошельки и DEX | большинство кошельков; программа должна явно принимать Token-2022 |

В неделе 2 мы разбирали Metaplex-минт NFT: там метаданные лежат в
**отдельном** PDA программы Token Metadata. Здесь тот же смысл (имя, символ,
uri) записан в сам mint, а `MetadataPointer` сообщает кошелькам, где искать.

## Устройство mint-аккаунта PETCOIN

```
[0..82)    базовый Mint: mint_authority, supply, decimals=6, is_initialized, freeze_authority=None
[82..165)  padding до размера Account (чтобы mint и token account не путались по длине)
[165]      AccountType = Mint
TLV:       TransferFeeConfig   — authority, withdraw authority, withheld_amount, older/newer fee
           MetadataPointer     — authority, metadata_address = сам mint
           TokenMetadata       — update_authority, mint, name, symbol, uri, additional_metadata[]
```

Порядок инструкций при создании в `createPetcoinMint` важен:

1. `SystemProgram.createAccount`: `space` = только фиксированные расширения
   (`getMintLen([TransferFeeConfig, MetadataPointer])`), а **lamports** сразу
   на весь итоговый размер, вместе с метаданными;
2. `InitializeTransferFeeConfig` и `InitializeMetadataPointer`: расширения
   с фиксированным размером инициализируются **до** `InitializeMint`, после
   него их уже не добавить;
3. `InitializeMint` (decimals 6, без freeze authority: замораживать
   кошельки игроков игре не нужно);
4. `TokenMetadata::Initialize` и `UpdateField` для своих полей. Программа сама
   делает realloc аккаунта, но rent должен быть уже оплачен в шаге 1.

Всё это одна транзакция: либо токен создан целиком, либо ничего.

## Комиссия за перевод

`TransferCheckedWithFee` требует, чтобы отправитель **сам указал** ожидаемую
комиссию. Если она не совпадает с расчётом программы, перевод отклоняется
(`FeeMismatch`). Так изменение комиссии между подписью и исполнением не
застанет отправителя врасплох. Клиент считает её через `calculateEpochFee` по
текущей эпохе.

Комиссия не уходит сразу в казну. Она **удерживается** (`withheld_amount`) на
токен-аккаунте получателя, и сбор идёт в два шага:

| Инструкция | Кто может | Что делает |
|---|---|---|
| `HarvestWithheldTokensToMint` | **любой** | переносит удержанное с аккаунтов держателей в mint |
| `WithdrawWithheldTokensFromMint` | только withdraw authority | из mint на указанный аккаунт |

`npm run petcoin -- collect-fees` находит все аккаунты с удержанием через
`getProgramAccounts` (memcmp: mint на offset 0) и делает оба шага одной
транзакцией.

Для экономики игры это **сток валюты**: 1% каждого перевода между игроками
(например, на Marketplace) возвращается в казну.

## Клиент

```bash
npm install
npm run petcoin -- create                                  # mint; адрес → clients/.petcoin-mints.json (по RPC)
npm run petcoin -- show
npm run petcoin -- mint --amount 1000 [--to <wallet>]
npm run petcoin -- transfer --to <wallet> --amount 25
npm run petcoin -- balance [--wallet <address>]
npm run petcoin -- holders
npm run petcoin -- meta --field description --value "In-game currency of PetNFT"
npm run petcoin -- meta --field uri --value https://<хостинг>/petcoin/metadata.json
npm run petcoin -- meta --remove description
npm run petcoin -- collect-fees
npm run petcoin -- burn --amount 10.5
```

Суммы задаются строкой и переводятся в целые единицы (`parseAmount("12.5")` →
`12_500_000n`) без float. Кошелёк и RPC те же, что у остальных клиентов
(`ANCHOR_WALLET`, `SOLANA_RPC_URL`, по умолчанию devnet). Изменение метаданных
сначала доплачивает rent на mint, если аккаунт вырастет.

Прогон на локальном валидаторе (surfpool):

```
$ npm run petcoin -- create
mint        9imz1ght6RwQn2z2UhpRWCXgn5a4YWBxXn7aTr65Wqiy  (owner: Token-2022 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
supply      0 PET   decimals 6
authority   mint 24n8gghfzFHxoJwJfcWg5c8ziJeSc6EzHaF73ZvsM4fp · freeze —
extensions  TransferFeeConfig, MetadataPointer, TokenMetadata
fee         1% (max 5 per transfer, from epoch 0) · withheld in mint 0
metadata →  9imz1ght6RwQn2z2UhpRWCXgn5a4YWBxXn7aTr65Wqiy (the mint itself)
name        PetCoin
symbol      PET
uri         http://localhost:5173/petcoin/metadata.json
  game: PetNFT
  utility: mini-games, quests, marketplace

$ npm run petcoin -- mint --amount 1000
minted 1000 PET to 24n8gghf…M4fp (token account 56ubkfP6…e83A)

$ npm run petcoin -- transfer --to 8LNCwYwd…Yvf7 --amount 25
fee  0.25 PET withheld on the recipient's account, recipient received 24.75

$ npm run petcoin -- transfer --to 8LNCwYwd…Yvf7 --amount 800
fee  5 PET withheld on the recipient's account, recipient received 795      # 1% = 8, потолок 5

$ npm run petcoin -- holders
8LNCwYwdz3gW75dGKsZQk7WAPKsGD7Nur5RLy8AWYvf7         819.75 PET   withheld 5.25
24n8gghfzFHxoJwJfcWg5c8ziJeSc6EzHaF73ZvsM4fp            175 PET   withheld 0

$ npm run petcoin -- collect-fees
collected 5.25 PET from 1 account(s) + the mint

$ npm run petcoin -- burn --amount 10.5
balance now 169.75 PET                                                      # 175 + 5.25 − 10.5
```

## Тесты — `tests/petcoin.ts`

Своей программы здесь нет: тесты работают напрямую с программой Token-2022
через тот же `petcoin-core.ts`, что и CLI.

1. `parseAmount` / `formatAmount`: точность 6 знаков, лишние знаки и минус отклоняются;
2. mint принадлежит Token-2022, decimals 6, без freeze authority, ровно три расширения, pointer указывает на сам mint, метаданные совпадают;
3. mint на ATA увеличивает supply;
4. mint от чужого ключа: `0x4` **OwnerMismatch**;
5. перевод 100 PET: получатель видит 99, 1 удержан на его аккаунте;
6. перевод 800 PET: комиссия 5, а не 8 (потолок);
7. неверно указанная комиссия: `0x20` **FeeMismatch**;
8. перевод между игроками, комиссия удерживается снова;
9. перевод больше баланса: `0x1` **InsufficientFunds**;
10. изменение `uri` и своего поля, удаление поля; чужой ключ: `0x35c2b5c0`
    **TokenMetadataError::IncorrectUpdateAuthority**;
11. `collect-fees` собирает 1 + 5 + 0.5 = 6.5 PET с двух аккаунтов, в mint остаётся 0;
12. burn уменьшает баланс и supply.

```
$ ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=<keypair> npm run test:petcoin
  petcoin (Token-2022)
    ✔ parses and formats amounts without floats
    ✔ creates a Token-2022 mint with fee, metadata pointer and on-mint metadata
    ...
    ✔ burn reduces balance and supply
  12 passing (4s)
```

Тест пополняет второго игрока **переводом SOL**, а не airdrop, поэтому тот же
набор пойдёт и против Devnet.

## Что проверено, а что нет

- ✅ **Devnet:** токен выпущен, 1000 PET отминчено на кошелёк автора (видно в
  Phantom). **12/12 тестов против Devnet** (24 с) и 12/12 на локальном
  валидаторе surfpool 1.6.0.
- ✅ `holders` и `collect-fees` проверены в Devnet: с тестового mint
  собрано 6.5 PET удержанных комиссий с двух аккаунтов
  ([`4qkAuBLg…y2d9S`](https://explorer.solana.com/tx/4qkAuBLgo3xnWE7w2LnvgQLhjbeS8caL2oXaSqZBwqUNCytnjp53Ya2JokN4RJy8zv7nmgVBURcqFZaSC6Ay2d9S?cluster=devnet)).
- ⏳ `uri` указывает на `http://localhost:5173/...`, поэтому кошельки
  показывают имя и символ (они в mint), но не картинку. После публикации
  фронтенда: `npm run petcoin -- meta --field uri --value <публичный URL>`.
- Игровой баланс `petCoins` в базе бэкенда пока **не связан** с токеном:
  награды за мини-игры и квесты начисляются off-chain, как и раньше. Вывод
  этих монет в настоящий токен — следующий шаг.

### Подвох: getProgramAccounts по Token-2022 в Devnet

Публичный RPC `api.devnet.solana.com` отвечает на `getProgramAccounts` по
программе Token-2022 ошибкой `excluded from account secondary indexes`.
Поэтому `petcoinHolders` при такой ошибке идёт по истории mint:
`getSignaturesForAddress(mint)` → каждая транзакция → `postTokenBalances`
с нашим mint → адреса токен-аккаунтов → `getMultipleAccountsInfo`. Транзакции
читаются по одной: пакетные запросы публичный RPC режет ответом 429. Для
продакшена нужен RPC с индексом (Helius, Triton) или свой индексатор.

## Задеплоено в Devnet ✅

| Что | Адрес / подпись |
|---|---|
| PETCOIN mint | [`E3tAx6RP3T83PcQ5FRfxhtpdVo26icMTpeCMqwt7KunA`](https://explorer.solana.com/address/E3tAx6RP3T83PcQ5FRfxhtpdVo26icMTpeCMqwt7KunA?cluster=devnet) |
| Mint / update / fee authority | `4z89KmKFjvByF1cMo3SjLRyLAQmBZRw9TfbmbkQLwmBf` |
| `create` (mint + 3 расширения одной транзакцией) | [`37T1xUSF…vJRSfx`](https://explorer.solana.com/tx/37T1xUSFdtLeaxrd2VvZj6QirUFe8125bPxsjaTwv1s6eL96h64wJHbWqHoBrYbXTazcHWkZSedJhGL9CvvJRSfx?cluster=devnet) |
| `mint --amount 1000` | [`4R7t4LJY…zzMbo4PK`](https://explorer.solana.com/tx/4R7t4LJYMR8yyammBLZwMDjXwfrreAeBnxt4L9oByqJrtcxXeHE992cQPrkuwnbAMhHMQmwYRf2Hw2EbzzMbo4PK?cluster=devnet) |
