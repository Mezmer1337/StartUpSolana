# Задания 11–13. Raydium в Devnet: пулы, swap, позиции CLMM

**Задание 11:** изучить пулы ликвидности, создать тестовые токены и
CLMM-пул в Devnet.
**Задание 12:** обмен через CLMM-пул с учётом допустимого проскальзывания.
**Задание 13:** открыть позицию в пуле, собирать комиссии, закрывать и
перемещать её при изменении цены. Все — РО3.

**Что сделано:**

- два внутриигровых тестовых токена **FOOD** (корм) и **GEM** (самоцветы),
  SPL Token, 6 знаков, по 1 000 000 на кошелёк;
- **CPMM-пул** (AMM x·y=k) и **CLMM-пул** (концентрированная ликвидность)
  FOOD/GEM на программах Raydium в Devnet, цена 2 GEM за FOOD;
- swap через CLMM с котировкой, `minAmountOut` и проверкой, что программа
  действительно отклоняет сделку хуже минимума;
- позиции: открыть в диапазоне, посмотреть несобранные комиссии, собрать,
  закрыть, и `rebalance`: позиция вышла из диапазона → закрыть, выровнять
  токены swap'ом, открыть заново вокруг новой цены;
- всё через `@raydium-io/raydium-sdk-v2`: модуль `clients/raydium-core.ts`
  и CLI `clients/raydium.ts`. Своей on-chain программы здесь нет — работаем
  с программами Raydium.

## Пулы ликвидности: AMM и CLMM

| | CPMM (AMM) | CLMM |
|---|---|---|
| Программа Devnet | `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` | `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH` |
| Кривая | x·y = k на всём диапазоне цен (0, ∞) | x·y = L² только внутри диапазона позиции |
| Доля LP | fungible LP-токен (SPL mint) | **NFT**: у каждой позиции свой диапазон |
| Эффективность капитала | низкая: почти вся ликвидность далеко от цены | высокая: ликвидность там, где идут сделки |
| Комиссии | капают в резервы, растёт цена LP-токена | копятся отдельно, их надо собирать |
| Риск | impermanent loss | IL сильнее + позиция может выйти из диапазона и перестать зарабатывать |
| Создание в Devnet | 0.15 SOL сбора + rent | только rent |

AMM v4 (самый старый тип Raydium) требует рынок OpenBook, поэтому для
«классического AMM» взят CPMM: та же формула x·y=k, но без OpenBook, с
поддержкой Token-2022, и именно его Raydium создаёт для новых пулов.

### Цена, тики, sqrtPriceX64

В CLMM цена хранится не числом, а **тиком**: `price = 1.0001^tick`
(с поправкой на decimals). В состоянии пула — `sqrtPriceX64 = √price · 2⁶⁴`
(фиксированная точка: целочисленная математика без float). Позиция начинается
и заканчивается только на тиках, кратных `tickSpacing` конфига (у тира 0.25%
это 60). Поэтому диапазон 1.8–2.2 превратился в 1.7896–2.2077: `rangeToTicks`
расширяет его наружу до ближайших допустимых тиков.

Цена пула — всегда «сколько mintB за 1 mintA», а mintA/mintB SDK упорядочивает
**по адресу**. У нас A = GEM, B = FOOD, поэтому пул хранит 0.5 (FOOD за GEM), а
клиент везде показывает 2 GEM за FOOD (`foodPrice` / `toPoolPrice`).

### Fee-тиры Devnet

Конфиги — отдельные аккаунты программы (PDA `["amm_config", index]`); клиент
читает их прямо из сети (`npm run raydium -- configs`):

```
CPMM  #0 0.25%  #1 0.3%  #2 0.5%  #3 1%  #4 4%  #5 0.5%  #6 0.005%  #7 0.35%   (create fee 0.15 SOL)
CLMM  #0 0.25% tick spacing 60   #1 0.01% spacing 1   #2 0.05% spacing 10
```

Меньше комиссия → меньше `tickSpacing` → точнее диапазоны (для стейблкоинов).
Для игровых токенов взят 0.25% / 60.

## Задание 11: токены и пулы

```bash
npm run raydium -- tokens                         # FOOD, GEM → clients/.raydium-devnet.json
npm run raydium -- cpmm-create --food 1000 --gem 2000
npm run raydium -- cpmm-pool
npm run raydium -- clmm-create --price 2 --config 0
npm run raydium -- clmm-pool
```

```
$ npm run raydium -- cpmm-pool
pool      Etq3sG3cdnfvmgeftHBFE4Zb9bLX6Ehb4xpYmq6KGKi   (CPMM, fee 0.25%)
reserves  2000 GEM · 1000 FOOD
k = x·y   2000000.00
price     2.000000 GEM per FOOD
LP supply 1414.213562                       # = √(1000·2000): первый LP получает √k

$ npm run raydium -- clmm-pool              # сразу после создания
price      2.000000 GEM per FOOD   (pool: 0.500000 B per A)
tick       -6932   sqrtPriceX64 13043817825332782213
liquidity  0  (active at the current price only)
vaults     0 GEM · 0 FOOD
```

CPMM создаётся сразу с резервами, а CLMM — пустым: в нём есть только цена, а
ликвидность появляется вместе с позициями (задание 13).

## Задание 12: swap с проскальзыванием

```bash
npm run raydium -- swap --in FOOD --amount 10 [--slippage 0.5]
npm run raydium -- swap --in GEM --amount 20 --min-out 11      # заведомо невыполнимый минимум
```

1. Котировка считается **оффчейн той же математикой, что у программы**:
   `PoolUtils.computeAmountOutFormat` проходит по tick arrays пула — по
   отрезкам с постоянной ликвидностью, пересекая инициализированные тики;
2. `minAmountOut = amountOut · (1 − slippage)`. Он уходит в инструкцию
   `swap_v2` как `other_amount_threshold`;
3. программа исполняет обмен по **текущему** состоянию пула; если между
   котировкой и исполнением цену кто-то сдвинул и вышло меньше минимума —
   откат с `TooLittleOutputReceived` (6018). Клиент ничего не проверяет сам:
   гарантия даётся программой;
4. tick arrays, которые пересечёт swap, передаются в `remainingAccounts` —
   их тоже даёт котировка.

```
$ npm run raydium -- swap --in FOOD --amount 10
quote     10 FOOD -> 19.854528 GEM
min out   19.755255 GEM   (slippage 0.5%: the program rejects anything less)
fee       0.025 FOOD   price impact 0.9548%
received  19.854528 GEM (paid 10 FOOD)          # ровно по котировке: между ними никто не торговал

$ npm run raydium -- swap --in GEM --amount 20 --min-out 11
quote     20 GEM -> 10.022734 FOOD
transaction failed: AnchorError thrown in programs/amm/src/instructions/swap_v2.rs:364.
  Error Code: TooLittleOutputReceived. Error Number: 6018. Error Message: Too little output received.
```

Price impact ~1% при сделке на 10 FOOD — потому что в пуле всего ~100 FOOD
ликвидности в диапазоне. Отсюда и практическое правило: slippage должен быть
больше ожидаемого impact плюс запас на движение цены, иначе сделки будут
откатываться.

## Задание 13: позиции

```bash
npm run raydium -- open --lower 1.8 --upper 2.2 --amount 100     # 100 FOOD + сколько нужно GEM
npm run raydium -- positions
npm run raydium -- collect --nft <mint>
npm run raydium -- close --nft <mint>
npm run raydium -- rebalance --nft <mint> --width 10 [--force]
```

**Позиция = NFT.** `open_position` минтит NFT и создаёт PDA
`["position", nft_mint]` с диапазоном тиков, ликвидностью L и «снимком»
`feeGrowthInside` на момент последнего обновления. Кто держит NFT, тот и
владеет ликвидностью: позицию можно передать или продать.

**Сколько каждого токена.** Внутри диапазона нужны оба токена в пропорции,
которая зависит от того, где текущая цена: ближе к нижней границе — больше
GEM, к верхней — больше FOOD. Указываем сумму одного токена, SDK считает L и
второй (`getLiquidityAmountOutFromAmountIn`), а `otherAmountMax` с запасом на
slippage ограничивает, сколько программа может списать.

**Комиссии.** Пул копит `feeGrowthGlobal` — комиссию на единицу ликвидности.
Несобранное у позиции = `L · (feeGrowthInside_now − feeGrowthInside_last)`,
где «inside» считается по `feeGrowthOutside` граничных тиков. Клиент читает
эти тики и показывает сумму (`PositionUtils.GetPositionFees`). Отдельной
инструкции collect у Raydium нет: `decrease_liquidity` с L = 0 рассчитывает
комиссии и переводит их владельцу.

**Закрытие.** `decrease_liquidity(всю L)` + сбор комиссий + `close_position`
(сжигает NFT, возвращает rent) — одной транзакцией, с `amountMinA/B` от
текущей стоимости позиции минус slippage.

**Перемещение (`rebalance`).** Когда цена ушла за диапазон, позиция не
зарабатывает и целиком состоит из одного токена — того, который «дешевел»
(пул продал ей его, а второй забрал). Ребалансировка:

1. закрыть позицию: ликвидность и комиссии возвращаются в кошелёк;
2. обменять половину излишка по стоимости на второй токен — через тот же пул;
3. открыть новую позицию ±width% вокруг цены **после** этого обмена, на
   столько, на сколько хватает обоих токенов.

### Сценарий в Devnet

```
$ npm run raydium -- open --lower 1.8 --upper 2.2 --amount 100
open   1.7896–2.2077 GEM/FOOD: 100 FOOD + up to 225.456403 GEM
NFT    8ivbkKzJynRPgW2HbTNiUmXUjNLNDqLUYMsgAerV6qnz

$ npm run raydium -- open --lower 1 --upper 4 --amount 300          # широкая «фоновая» позиция, как у другого LP
$ npm run raydium -- swap --in GEM --amount 40                      # комиссия 0.1 GEM
$ npm run raydium -- collect --nft 8ivbk…6qnz
collected ~0.056658 GEM + ~0.020999 FOOD

$ npm run raydium -- swap --in FOOD --amount 250 --slippage 1       # цену уводим вниз
pool now  1.579002 GEM per FOOD (tick -4569)

$ npm run raydium -- positions
NFT    7qsmh3uNfV6skXejwPSZoa7t1ZpDDECBgPFxpQbKQLYn
range  1.0000–4.0226 GEM/FOOD  (ticks -13920..0)  IN range: earning fees
NFT    8ivbkKzJynRPgW2HbTNiUmXUjNLNDqLUYMsgAerV6qnz
range  1.7896–2.2077 GEM/FOOD  (ticks -7920..-5820)  OUT of range: no fees
holds  0 GEM + 218.579096 FOOD   liquidity 2933690342                # весь GEM продан
fees   0 GEM + 0.257058 FOOD uncollected

$ npm run raydium -- rebalance --nft 8ivbk…6qnz --width 10
price 1.579002 GEM/FOOD, range 1.7896–2.2077 -> OUT of range
close  …   got back 218.836154 FOOD + 0 GEM
swap   …   109.418077 FOOD -> 157.117928 GEM        pool now 1.312396
open   1.1759–1.4506 GEM/FOOD: 156.180842 GEM + up to 109.264336 FOOD
NFT    FEkfDTwucK3W4VvvqYyP2NmEX6sr2mBpnZJf7x1XMho7
range  1.1759–1.4506 GEM/FOOD  IN range: earning fees
```

Что здесь видно:

- **Комиссия делится по ликвидности в диапазоне.** Из 0.1 GEM узкая позиция
  (L = 2.93·10⁹) получила 0.0567, широкая (L = 1.42·10⁹) — 0.0273, остальные
  16% забрал Raydium (в конфиге #0: protocol 12% + fund 4% от комиссии).
  Узкая позиция внесла меньше токенов, но заработала
  вдвое больше: это и есть эффективность капитала CLMM.
- **Impermanent loss.** На входе было 100 FOOD + 224 GEM (≈ 424 GEM по цене 2),
  после падения цены до 1.58 — 218.8 FOOD ≈ 345 GEM. Держи мы токены, было бы
  100·1.58 + 224 ≈ 382 GEM.
- **Ребалансировка в тонком пуле сама двигает цену.** Swap 109 FOOD сдвинул
  цену с 1.579 до 1.312 (impact 17%), поэтому новый диапазон считается от цены
  после обмена. В реальном пуле излишек меняют через более глубокий маршрут
  (агрегатор) или открывают несимметричный диапазон без обмена.

## Подвохи

1. **SDK 0.2.80 падает на пустом CLMM-пуле.** `clmm.getPoolInfoFromRpc` делает
   `Object.values(tickData[poolId])`, а у только что созданного пула нет ни
   одного tick array, и записи нет вовсе. В `raydium-core.ts` обёрнут
   `PoolUtils.fetchMultiplePoolTickArrays`: недостающий пул получает пустой
   кэш.
2. **API Raydium для Devnet не нужен.** Fee-конфиги читаются из сети
   (`ClmmConfigLayout`, `CpmmConfigInfoLayout` по PDA конфигов), описания
   токенов собираются вручную (`apiToken`), `Raydium.load` с
   `disableLoadToken: true`.
3. **Позиции ищутся по NFT в кошельке**, а SDK кэширует token accounts:
   сразу после `open` в том же процессе список был пуст. Перед выводом —
   `fetchWalletTokenAccounts({ forceUpdate: true })`.
4. **Ошибка исполнения** приходит из SDK не как `Error`, а как
   `{ InstructionError, txId }`. Клиент дочитывает логи транзакции и
   показывает строку `Error Code: …`.
5. Публичный RPC Devnet отвечает 429 на частые запросы; SDK и web3.js
   повторяют сами, команды просто идут дольше.

## Что проверено, а что нет

- ✅ Всё выше выполнено в Devnet: токены, оба пула, 4 swap'а (один
  намеренно отклонён программой), 3 позиции, collect, rebalance. Подписи — в
  таблице.
- ✅ `npm run typecheck` чистый.
- ⏳ Автотестов нет: программ Raydium нет на локальном валидаторе, а прогон в
  Devnet создаёт пулы за SOL. Проверка — сценарий выше.
- ⏳ swap через CPMM-пул не реализован (только создание и просмотр): задание
  12 требует CLMM.
- ⏳ PETCOIN в пулы не добавлен: у него комиссия Token-2022 1%, и CLMM считал
  бы котировки с поправкой на неё. Тестовые токены проще для разбора.

## Devnet ✅

| Что | Адрес / подпись |
|---|---|
| FOOD (mint) | [`6tTxUzWLkaVDpvf22wkixcdcwECZ6hNkJzraeGGFTBsP`](https://explorer.solana.com/address/6tTxUzWLkaVDpvf22wkixcdcwECZ6hNkJzraeGGFTBsP?cluster=devnet) |
| GEM (mint) | [`5ZANSn9gcCYizFF1YHNTZGLjyB78H2z2DKX8Ducyqtso`](https://explorer.solana.com/address/5ZANSn9gcCYizFF1YHNTZGLjyB78H2z2DKX8Ducyqtso?cluster=devnet) |
| CPMM-пул FOOD/GEM | [`Etq3sG3cdnfvmgeftHBFE4Zb9bLX6Ehb4xpYmq6KGKi`](https://explorer.solana.com/address/Etq3sG3cdnfvmgeftHBFE4Zb9bLX6Ehb4xpYmq6KGKi?cluster=devnet) · [создание](https://explorer.solana.com/tx/32Y3Fw6hP5uw96kMHSRXPXBZpvqyXi8rVfaCQi2aNgi97hZfaZwTsieCfXiQxgAR92KToJQ1a9aFqahSHB48X64k?cluster=devnet) |
| CLMM-пул FOOD/GEM, 0.25% | [`6E2MifZ5vxYmYsJHRcuMZrpR1KpWqF5HMspQpJrnA9wQ`](https://explorer.solana.com/address/6E2MifZ5vxYmYsJHRcuMZrpR1KpWqF5HMspQpJrnA9wQ?cluster=devnet) · [создание](https://explorer.solana.com/tx/2kaWV7wkXhrMN4SK9tyNp3P4mtfJyitCJsMf11AtFjrDgm77bvHDDKyoxSYeQZqXxg3jcDNQNRqcrzkGyTj4ssZ6?cluster=devnet) |
| open 1.79–2.21 | [`54hz2mmd…`](https://explorer.solana.com/tx/54hz2mmdxKfwwuohRScNdEj5NFN9LhM2n1BWQ42hAbsEWtphYeKgURnAuoQRRbjeVupsrcKvjkFLaEEPpVAwKwr8?cluster=devnet) |
| swap 10 FOOD → GEM | [`JdoUWFGg…`](https://explorer.solana.com/tx/JdoUWFGgafERXAQ4YLzpDwedUJ16xtXmqUsop2TfGtnaU1DVR9sumenxV4utQU2sUK299jzwn7Gi1yx5t8w1iyK?cluster=devnet) |
| swap отклонён: `TooLittleOutputReceived` | [`5XHg8Fa5…`](https://explorer.solana.com/tx/5XHg8Fa5c9wzZb1qw3NeDu4QeBCc9rEtx786pNgWn9hccPT7TQtcQrJWB4pVpMkSk5vNeHLTVDrCWWvV6cw9gHKZ?cluster=devnet) |
| open 1–4 (фоновая) | [`5SAQD1ei…`](https://explorer.solana.com/tx/5SAQD1eifymNtTkKMt13682cPpFMtUVMscNDTTfMpPCQbHFmeowTqzEiqcy3Bi9zRc4itfHieYYzN4G8bMSWsXof?cluster=devnet) |
| swap 40 GEM → FOOD | [`V1PvcMx6…`](https://explorer.solana.com/tx/V1PvcMx6ncvKQrPCkRSA1RhbveSwAz7dr9gU7zxxVCCaUUXU5kidB9uHm2cnPSBsmgm5fQueBpgSDardXGKkW6N?cluster=devnet) |
| collect | [`5xK1opYk…`](https://explorer.solana.com/tx/5xK1opYkhBRFBeCyS6V51arz4T9p6MQYthA694oHmiJZyDnzKatkNofpkaSKgRDbPjYC9Hff5diYGyHxbNB16w1a?cluster=devnet) |
| swap 250 FOOD (цена вниз) | [`vZ19BbqH…`](https://explorer.solana.com/tx/vZ19BbqHHsme1Tz8wDfaDVtmZmCepQ8yYTJ7wpeP3K86uGAFnhAVNJUj2etCfg68JuHP7c1FtefbVcuU9obY3iw?cluster=devnet) |
| rebalance: close | [`85fD9yvu…`](https://explorer.solana.com/tx/85fD9yvuPbv18vAqEc86FMXfQ6jUW9fjzW6EVJMNQ8ub98oZw3eYfQW32zqHx2o78qprZKQywCtfZbVnBa51Tis?cluster=devnet) |
| rebalance: swap | [`2ZpteSZS…`](https://explorer.solana.com/tx/2ZpteSZSs8eHNJgfr5ZxkoBeVSdUyfNkE3g48XP2EbDWB1LFKzqKyzwUrHESr2tcNqhBPX2pMGMgkDPzcfD9bWCc?cluster=devnet) |
| rebalance: open 1.18–1.45 | [`4cpV2Sbd…`](https://explorer.solana.com/tx/4cpV2SbdgYKatvShFtaJi6sFHMpizAP8ELJzPCAsERzhMmL4cJQmWmTRiqkRCAUxZyKvBFgVzbw5xuMCQRFspCpW?cluster=devnet) |
