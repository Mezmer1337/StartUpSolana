# PetNFT

PetNFT — Web3 GameFi MVP на **Solana Devnet**: вы подключаете кошелёк
Phantom, платите SOL за минт, и получаете уникального питомца, чья ДНК
(вид тела, части, узор, палитра, редкость, элементальная аура)
генерируется детерминированно из криптографического seed. Питомца можно
кормить/тренировать/эволюционировать, зарабатывать PETCOIN в мини-играх и
квестах, а затем превратить в настоящий NFT в блокчейне и торговать им на
Marketplace.

Это учебный / портфолио-MVP, а не продакшен-игра. Полный список того, что
реально работает end-to-end, а что упрощено и почему — в разделе
[MVP / заглушки](#mvp--заглушки).

> **Курс Solana, недели 2–5.** Задания силлабуса выполнены на этом проекте:
> Transaction Detective (неделя 2), Rust CLI `petdna` (3), нативная программа
> `pet_passport` (4) и Anchor Counter `pet_counter` (5). Обзор и разборы —
> в [docs/course](docs/course/README.md).

## Содержание

- [Концепция](#концепция)
- [Архитектура](#архитектура)
- [Генерация DNA и PRNG](#генерация-dna-и-prng)
- [Редкость и Trait Score](#редкость-и-trait-score)
- [Элементальная аура](#элементальная-аура)
- [Эволюция](#эволюция)
- [Dynamic Mint Price](#dynamic-mint-price)
- [Anti-bot защита](#anti-bot-защита)
- [PETCOIN, мини-игры и квесты](#petcoin-мини-игры-и-квесты)
- [Marketplace и экономика](#marketplace-и-экономика)
- [Стек](#стек)
- [Структура проекта](#структура-проекта)
- [Предварительные требования](#предварительные-требования)
- [Установка и запуск](#установка-и-запуск)
- [Devnet и подключение Phantom](#devnet-и-подключение-phantom)
- [Создание (минт) питомца](#создание-минт-питомца)
- [Минт NFT](#минт-nft)
- [Solana-программа (Anchor)](#solana-программа-anchor)
- [Тесты](#тесты)
- [API reference](#api-reference)
- [MVP / заглушки](#mvp--заглушки)
- [Что дальше](#что-дальше)

## Концепция

```
Wallet → оплата SOL → Seed → SHA-256 → seeded PRNG → уникальный Pet DNA
  → Pet (в базе) → Care / Mini-games / Quests → XP → Level Up → Evolution
  → Mint как NFT (Metaplex, Devnet) → Marketplace
```

Важная оговорка из ТЗ, которую мы соблюдаем буквально: 256-битный хэш сам
по себе не является *математической гарантией* уникальности. Поэтому при
каждом минте DNA-хэш дополнительно проверяется на уникальность в базе
данных (с повторной генерацией при коллизии) — см.
[backend/src/services/dnaService.ts](backend/src/services/dnaService.ts).

## Архитектура

```
Phantom Wallet  <──подписывает tx──>  Frontend (React)
      │  оплата SOL в treasury               │  REST (axios)
      ▼                                       ▼
 Solana Devnet  <──проверяется backend'ом── Backend (Express)
      ▲                                       │  Prisma ORM
      │                                       ▼
      └── Metaplex NFT mint ──────────  SQLite база данных
```

- **Off-chain (база backend'а):** всё изменяемое игровое состояние —
  характеристики питомца, XP/уровень, инвентарь, листинги маркетплейса,
  прогресс квестов, история мини-игр. Это сознательное решение — держать
  НЕ в блокчейне: Tamagotchi-механика с действиями каждые несколько минут
  означала бы devnet-транзакцию (и попап Phantom) на каждое действие.
- **On-chain (Solana Devnet):**
  - **Оплата минта** — реальный перевод SOL от игрока в treasury-кошелёк,
    который backend **независимо проверяет напрямую по devnet RPC**
    (сумма, отправитель, получатель, отсутствие повторного использования
    подписи) прежде чем создать питомца — см.
    [Dynamic Mint Price](#dynamic-mint-price).
  - **NFT** — после того как вы решите заминтить готового питомца, его
    mint-аккаунт, SPL token account и аккаунт Metaplex Token Metadata
    создаются прямо из фронтенда, кошельком Phantom в качестве
    подписанта — backend никогда не хранит приватный ключ и никогда не
    отправляет транзакции от вашего имени.
- **Anchor-программа (`programs/petnft`):** *дополнительный*,
  необязательный ончейн-реестр PDA — см.
  [Solana-программа](#solana-программа-anchor). Anchor 1.2, задеплоена в
  Devnet: `nDWNF4Za1PgtFxUBfvfuXf3A6AKrGyq6vu7jwWTRzfJ`.
- **Программы курса (задеплоены в Devnet):** `programs/pet_counter` (Anchor,
  счётчик ухода, `F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P`) и
  `native/pet_passport` (без Anchor, on-chain паспорт с `dnaHash`,
  `2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U`) — см.
  [docs/course](docs/course/README.md).

## Генерация DNA и PRNG

Реализовано в [backend/src/services/dnaService.ts](backend/src/services/dnaService.ts)
и [backend/src/constants/dna.ts](backend/src/constants/dna.ts):

1. **Seed.** При минте backend строит `wallet:petName:timestamp:randomNonce`
   и берёт от него `sha256` → `seedHash`. Сам seed никогда не сохраняется
   и никогда не является реальной seed-фразой кошелька (ТЗ прямо это
   запрещает) — только публичный адрес + серверная случайность.
2. **Seeded PRNG.** `seedHash` кормит детерминированный PRNG (Mulberry32),
   производящий поток чисел из хэша. Один и тот же `seedHash` **всегда**
   даёт одну и ту же ДНК — это буквально протестировано (см.
   [Тесты](#тесты)).
3. **Архетип.** PRNG сначала выбирает фундаментальную форму — `ROUND`,
   `QUADRUPED`, `HUMANOID`, `BIRD`, `AQUATIC` — каждая со своим набором
   совместимых "sockets" (ears/eyes/mouth/tail/legs/wings/fins/special).
4. **Части тела.** Для каждого socket архетипа PRNG выбирает опцию
   взвешенным случайным выбором (например уши: round/pointed/floppy/
   tufted/none — каждая с своим весом и вкладом в редкость).
5. **Body params.** `width/height/size/headSize` — каждый в диапазоне
   0.8–1.2, тоже из PRNG.
6. **Цвет.** `baseHue` (0–360°) + случайно выбранная harmony-схема
   (analogous / complementary / triadic / splitComplementary) → палитра
   из primary/secondary/patternColor/accent/outline (outline —
   автоматически более тёмный вариант primary). См.
   [backend/src/services/colorService.ts](backend/src/services/colorService.ts).
7. **Узор.** solid/spots/stripes/gradient/scales/geometric — тоже
   взвешенный выбор, хранится как `pattern` в traits.
8. **Уникальность.** Итоговый `dnaHash = sha256(archetype+traits+body+palette+aura+seedHash)`
   проверяется на уникальность в базе (`Pet.dnaHash` — `@unique`); при
   коллизии (теоретически возможной, но статистически ничтожной) генерация
   повторяется со свежим seed — до 5 попыток.

**Честная оговорка про визуал:** части тела/узор/аура **реально
определяют** цвет и структуру данных питомца (и попадают в NFT-метаданные
как атрибуты), но пока не рендерятся как отдельные PNG/SVG-спрайты с
масками — вместо этого генерируется процедурно окрашенный SVG-портрет
(см. `PetViewer`/`metadataService.buildPetImageSvg`). Полноценный
per-part рендеринг — в [Что дальше](#что-дальше).

## Редкость и Trait Score

Редкость **не завязана на одно поле** — она считается по совокупности
всех выборов (архетип + каждая часть тела + узор + аура), брифу это
называется **Trait Score**: каждая опция несёт `rarityPoints`, сумма по
всем выбранным опциям — это и есть Trait Score питомца, который затем
маппится на один из шести уровней редкости:

`COMMON → UNCOMMON → RARE → EPIC → LEGENDARY → MYTHIC`

Пороги (`RARITY_SCORE_THRESHOLDS` в `constants/dna.ts`) были
**эмпирически откалиброваны** — в `backend/scripts/calibrate-rarity.ts`
лежит скрипт, который сэмплирует 50 000 сгенерированных питомцев и
печатает перцентили распределения Trait Score; именно на его выводе
основаны текущие пороги, ориентированные на целевое распределение из ТЗ
(~60/25/10/4/0.9/0.1%). Если меняете каталоги трейтов — перезапустите
скрипт и обновите пороги.

## Элементальная аура

Отдельный, крайне редкий бросок при генерации (брифом явно требуется
низкая вероятность и **чисто косметический** эффект — никакого
Pay-to-Win): `FIRE / WATER / EARTH / AIR / LIGHTNING / SHADOW / LIGHT /
VOID`, с настраиваемыми весами в `AURA_WEIGHTS` (сейчас ~0.2% на
"обычную" ауру, ~0.08% на "редкую", ~0.01% на "легендарную" — задаётся в
одном месте, легко потюнить). Питомец с аурой автоматически получает не
ниже LEGENDARY редкости. В интерфейсе аура рисуется как светящееся
кольцо вокруг питомца (`PetViewer`) и отдельным атрибутом в NFT-метаданных.

## Эволюция

Стадия роста — чистая функция уровня, не хранится отдельно и не требует
доп. состояния (`growthStageForLevel` в `constants/petData.ts` /
`types/pet.ts`):

| Уровень | Стадия |
|---|---|
| 1–4 | Baby |
| 5–14 | Young |
| 15–29 | Adult |
| 30+ | Evolved |

DNA питомца при этом **не меняется** — эволюция это история прогресса
поверх неизменной ДНК, ровно как требует ТЗ. Стадия влияет на масштаб
отображения в `PetViewer`.

## Dynamic Mint Price

Реализовано в [backend/src/services/economyService.ts](backend/src/services/economyService.ts):

```
priceSol = clamp(
  BASE_PRICE_SOL × demandMultiplier × supplyMultiplier,
  MIN_PRICE_SOL, MAX_PRICE_SOL
)
```

- **demandMultiplier** растёт со скоростью минта за последний час
  относительно "комфортной" цели (`TARGET_MINTS_PER_HOUR`).
- **supplyMultiplier** растёт по мере приближения общего числа
  заминченных питомцев к мягкому потолку (`TOTAL_SUPPLY_SOFT_CAP`) — это
  экономический рычаг, а не жёсткий лимит минта.
- Итоговая цена всегда зажата в `[MIN_PRICE_SOL, MAX_PRICE_SOL]`.
- **Сглаживание:** новая цена не подставляется напрямую — она EMA-
  усредняется с предыдущим значением (`PRICE_EMA_ALPHA`), и
  пересчитывается не чаще раза в `PRICE_RECOMPUTE_INTERVAL_MS` (5 минут).
  Между пересчётами всем отдаётся одна и та же закэшированная цена — она
  же пишется в таблицу `EconomySnapshot`, что заодно даёт настоящую
  историю цены, а не только кэш.
- Чистая математика цены вынесена в `calculateMintPrice()` — функция без
  побочных эффектов, отдельно покрытая тестами.

**Реальная on-chain оплата.** `GET /api/economy/mint-price` отдаёт
текущую цену и адрес treasury-кошелька. Фронтенд строит и отправляет
`SystemProgram.transfer` от кошелька игрока к treasury на эту сумму
(подписывается в Phantom), а backend, получив подпись транзакции,
**сам** идёт в devnet RPC (`getTransaction`), проверяет реальные
изменения баланса отправителя/получателя и **только после этого**
создаёт питомца — см.
[backend/src/services/solanaVerifyService.ts](backend/src/services/solanaVerifyService.ts).
Подпись транзакции сохраняется (`MintPayment.signature` — `@unique`), так
что один и тот же платёж нельзя переиспользовать для второго минта
(replay-защита).

## Anti-bot защита

Реализовано в [backend/src/services/antiAbuseService.ts](backend/src/services/antiAbuseService.ts)
— **всё на backend**, ничего нельзя обойти правкой fetch-запроса на
фронтенде:

- лимит минтов на кошелёк в час / в сутки (`MINT_LIMITS`, настраиваемо);
- burst-cooldown: N минтов за короткое окно → принудительная пауза
  (`BURST_LIMIT`);
- оплата и её сумма проверяются напрямую на цепочке (см. выше) — просто
  подделать `paymentTxSignature` в теле запроса нельзя, backend реально
  идёт в devnet и смотрит на баланс.
- мини-игры тоже ограничены по частоте на кошелёк в час
  (`MAX_GAME_COMPLETIONS_PER_HOUR` в `gameService.ts`) — базовая защита
  от фарма XP/PETCOIN, честно не претендующая на полноценный анти-чит
  (см. [MVP / заглушки](#mvp--заглушки)).

## PETCOIN, мини-игры и квесты

**PETCOIN** — отдельная внутриигровая валюта (`User.petCoins`), не SOL,
без вывода в реальные деньги. Начисляется за ежедневную награду,
мини-игры и квесты; тратится (в будущих версиях) на предметы/тренировки/
косметику.

**Мини-игры** (`GET /api/games`, `POST /api/games/:id/complete`):
в этом MVP реализованы **2 из 4** предложенных в ТЗ игр — честно, без
подделки остальных под тем же названием:
- 🎯 **Reaction** — кликнуть в момент, когда цель загорится зелёным;
  скорость реакции → очки.
- 🧠 **Memory** — повторить растущую последовательность плиток.
- Catch и специализированная Training-игра — не реализованы, см.
  [Что дальше](#что-дальше).

Награда (`xp = score × 0.5`, `petCoins = score × 0.3`) начисляется
backend'ом на основе присланного `score`, зажатого в `[0, maxScore]`
игры — счёт можно опционально применить к конкретному питомцу
(`applyGameReward`).

**Квесты** (`GET /api/quests?wallet=`, `POST /api/quests/:id/complete`):
прогресс **реально вычисляется** из append-only лога действий
(`ActionLog` — пишется при каждом Feed/Play/Train/GAME_COMPLETE/LEVEL_UP),
а не является заглушкой со случайным прогрессом. Ежедневные квесты
сбрасываются по UTC-суткам, недельные — по неделе (пн–вс UTC),
достижения — одноразовые (`QuestClaim` с уникальностью по
`wallet+questKey+период`, что не даёт забрать награду дважды).

## Marketplace и экономика

`GET /api/marketplace`, `POST /api/marketplace/list`, `POST
/api/marketplace/:id/cancel`, `POST /api/marketplace/buy` — листинг,
отмена и покупка питомцев с фильтрами по виду/редкости/цене/уровню.

Комиссии — **настоящий расчёт**, настраиваемый в одном месте
(`marketplaceService.MARKETPLACE_FEE_BPS`,
`MARKETPLACE_ROYALTY_BPS` — сейчас по 2.5% каждая):
`computeSaleBreakdown(priceSol)` возвращает `platformFeeSol`,
`royaltySol` и `sellerProceedsSol`, и это разбиение возвращается в ответе
`POST /marketplace/buy`. Что **остаётся заглушкой** — реальное движение
SOL по этому разбиению (см. [MVP / заглушки](#mvp--заглушки)).

## Стек

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4
- **Wallet:** `@solana/wallet-adapter-react` (+ `-react-ui`),
  автоопределение через Wallet Standard (Phantom, Solflare, Backpack, …)
- **NFT:** Metaplex `umi` SDK + `mpl-token-metadata`, минтится прямо из
  браузера, подписант — кошелёк пользователя
- **Backend:** Node.js + Express + TypeScript
- **База данных:** SQLite через Prisma ORM (переключение на PostgreSQL —
  одна строка, см. [`.env.example`](.env.example))
- **Смарт-контракты:** Anchor 1.2 + Rust (`petnft`, `pet_counter`),
  нативная программа на `solana-program` (`pet_passport`)
- **Rust CLI:** `petdna` — генератор ДНК, совместимый с бэкендом байт-в-байт
- **Тесты:** Vitest (backend), `cargo test` (Rust), mocha + `anchor test` (программы)
- **Пакетный менеджер:** npm

## Структура проекта

```
petnft/  (этот репозиторий)
├── frontend/              React + Vite приложение
│   └── src/
│       ├── components/    PetCard, PetViewer, CreatePetModal, games/, ...
│       ├── pages/         Landing, MyPets, PetProfile, MiniGames, Quests, ...
│       ├── context/       GameDataContext, ToastContext
│       ├── hooks/         useWalletBalance
│       ├── services/      api.ts, nft.ts (Metaplex минт), mintPayment.ts (SOL-платёж)
│       └── types/         Общие TypeScript-типы фронтенда
├── backend/               Express API
│   ├── src/
│   │   ├── controllers/   Обработчики запросов
│   │   ├── routes/        Express-роутеры
│   │   ├── services/      dnaService, economyService, antiAbuseService,
│   │   │                  solanaVerifyService, gameService, questService, ...
│   │   ├── middleware/     Обработка ошибок, валидация кошелька
│   │   └── constants/      dna.ts, petData.ts, items.ts
│   ├── prisma/             schema.prisma, миграции, seed.ts
│   ├── scripts/            calibrate-rarity.ts, tx-detective.ts (неделя 2), export-dna-vectors.ts
│   └── tests/               dna/economy/color/leveling/txDetective — см. "Тесты"
├── programs/petnft/       Anchor-программа: реестр PetRecord
├── programs/pet_counter/  Anchor Counter Program (неделя 5)
├── native/pet_passport/   Нативная программа без Anchor (неделя 4)
├── crates/petdna/         Rust CLI: ДНК, цена в lamports, Borsh PetRecord (неделя 3)
├── clients/               TS-клиенты для Devnet: pet-passport.ts, pet-counter.ts
├── tests/                 mocha-тесты Anchor-программ (anchor test)
├── docs/course/           Разборы недель 2–5 курса
├── shared/                 Константы только для справки (см. файл, почему)
├── README.md
└── .env.example
```

## Предварительные требования

- **Node.js 18+** и npm — нужны для запуска frontend и backend.
- **Расширение-кошелёк Phantom**, переключённое на **Devnet** — нужно,
  чтобы реально подключаться, платить за минт и минтить NFT.
- **Rust, Solana CLI, Anchor CLI** — нужны только если вы хотите сами
  собрать и задеплоить `programs/petnft`. Остальная часть приложения
  (frontend, backend, оплата минта, минт NFT) работает без них.

## Установка и запуск

### 1. Backend

```bash
cd backend
npm install
cp ../.env.example .env    # либо используйте уже готовый backend/.env
npm run db:setup           # prisma migrate + сидирует каталог предметов
npm run dev                # запускает http://localhost:4000
```

`.env` по умолчанию содержит placeholder-адрес `TREASURY_WALLET` (только
публичный ключ, приватного ключа для него нигде нет и не нужен — backend
лишь проверяет входящие платежи). Замените на свой devnet-адрес, если
хотите реально получать платежи за минт локально.

### 2. Frontend

Во втором терминале:

```bash
cd frontend
npm install
npm run dev                 # запускает http://localhost:5173
```

Откройте **http://localhost:5173** в браузере.

### 3. (Опционально) Solana-программа

См. [Solana-программа](#solana-программа-anchor) — для работы приложения
не требуется.

## Devnet и подключение Phantom

1. Установите расширение [Phantom](https://phantom.app/).
2. Откройте Phantom → Settings → **Developer Settings** → выберите сеть
   **Devnet**.
3. Получите бесплатные devnet SOL из фаусета, например:
   ```bash
   solana airdrop 2 <ваш-адрес-кошелька> --url devnet
   ```
   или через https://faucet.solana.com. **Devnet-фаусеты часто
   ограничивают частоту запросов**, особенно с "облачных" IP — если
   airdrop падает с ошибкой, попробуйте позже или другой faucet
   (см. [Как протестировать минт](#создание-минт-питомца)).
4. В приложении PetNFT нажмите **Sign in with Phantom** (справа сверху),
   подтвердите подключение, а затем **подпишите сообщение** «localhost:5173
   wants you to sign in with your Solana account…». Это не транзакция: она
   ничего не стоит и не уходит в блокчейн.

Все транзакции (оплата минта, минт NFT) подписываются вами в попапе
Phantom. PetNFT никогда не спрашивает seed-фразу и никогда не видит ваш
приватный ключ.

### Вход через Phantom (Sign In With Solana)

Подключить кошелёк — значит лишь сообщить сайту адрес. Войти — значит
доказать, что вы им владеете:

1. `POST /api/auth/nonce {wallet}` — бэкенд создаёт сообщение в формате SIWS
   с одноразовым nonce (живёт 5 минут). Сообщение привязано к домену сайта
   (`AUTH_ALLOWED_ORIGINS`) и к адресу кошелька.
2. Phantom подписывает текст сообщения ключом кошелька (ed25519).
3. `POST /api/auth/verify {wallet, nonce, signature}` — бэкенд проверяет
   подпись публичным ключом (адрес Solana и есть ed25519-ключ), гасит nonce
   и выдаёт токен сессии на 7 дней. В БД хранится только sha256 токена.
4. Все изменяющие запросы (минт, feed/play/train, мини-игры, квесты,
   награда, инвентарь, маркетплейс) требуют `Authorization: Bearer <token>`.
   Кошелёк в теле запроса (`ownerWallet`, `wallet`, `sellerWallet` …) обязан
   совпадать с кошельком сессии, иначе 403. Чтение (`GET`) остаётся открытым.

Во фронтенде это `context/AuthContext.tsx` и `components/AuthButton.tsx`.
Смена аккаунта в Phantom или отключение кошелька завершают сессию,
кнопка **Sign out** отзывает токен на бэкенде. Реализация:
`backend/src/services/authService.ts` и `middleware/auth.ts`, тесты —
`backend/tests/auth.test.ts`.

## Создание (минт) питомца

1. Войдите через Phantom (**Sign in with Phantom**).
2. Перейдите в **My Pets** → **+ Create Pet**. Модалка покажет **текущую
   динамическую цену минта** в SOL.
3. Выберите имя, вид (Cat/Dog/Fox/Dragon) и цвет.
4. Нажмите **Pay & Mint** — Phantom попросит подтвердить перевод SOL на
   treasury-адрес; после подтверждения фронтенд вызывает
   `POST /api/pets/mint`, backend **сам** проверяет платёж на цепочке и
   генерирует DNA — архетип/части тела/узор/палитра/редкость/аура
   раскрываются в модалке.
5. Питомец появляется в **My Pets** и на своей странице профиля —
   там показаны DNA-хэш, архетип, все traits, стадия роста, статы, и
   можно **Feed / Play / Rest / Train**, экипировать аксессуар, выставить
   на продажу или заминтить как NFT.

**Как протестировать реальный платёж.** Нужен кошелёк с devnet SOL —
проще всего через Phantom + фаусет (см. выше). Если официальный faucet
недоступен из вашей сети/облака, альтернативы: другой RPC-фаусет,
`solana airdrop` с ретраями, или перевод devnet SOL с другого вашего
devnet-кошелька. Негативные пути (отсутствие/невалидная подпись, повтор
уже использованной подписи) проверены end-to-end через настоящие вызовы
devnet RPC в рамках разработки этого MVP.

## Минт NFT

С профиля уже созданного питомца нажмите **⛓ Mint on Devnet**:

1. Фронтенд строит транзакцию создания NFT (mint-аккаунт + SPL token
   account + аккаунт метаданных Metaplex) через SDK `umi`, указывая в
   качестве `uri` метаданных адрес `GET /api/metadata/:petId` (отдаётся
   backend'ом; метаданные включают архетип/traits/ауру/Trait Score и
   процедурно сгенерированную SVG-картинку).
2. Phantom просит подтвердить и оплатить (крошечную, devnet) комиссию
   транзакции.
3. После подтверждения mint-адрес сохраняется в БД, на карточке питомца
   появляется бейдж **⛓ On-chain** со ссылкой на Solana Explorer (devnet).

Это отдельный шаг от оплаты минта (создания питомца) выше — платёж
создаёт игровую сущность в БД, а этот шаг превращает её в настоящий NFT.

## Solana-программа (Anchor)

`programs/petnft/src/lib.rs` — настоящая Anchor-программа, добавляющая
необязательный ончейн-PDA `PetRecord` (один на минт) поверх NFT
Metaplex — полное обоснование см. в doc-комментарии в начале файла,
включая честную оговорку про то, что проверка оплаты минта пока целиком
на backend'е, а не в этой программе.

Программа переведена на **Anchor 1.2**: собирается `anchor build` и проходит
свой тест на локальном валидаторе вместе с `pet_counter` (7/7, см.
[docs/course/week-05-anchor-counter.md](docs/course/week-05-anchor-counter.md)).
Приложение **не зависит** от неё — оплата минта и минт NFT работают так, как
описано выше, вне зависимости от этого. Собрать и проверить её вместе с
`pet_counter`:

```bash
# 1. Rust и Solana CLI (на Windows — через WSL2)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
solana config set --url devnet
solana-keygen new                       # создаст ~/.config/solana/id.json
solana airdrop 2

# 2. Anchor 1.2 (версия зафиксирована в Anchor.toml)
cargo install --git https://github.com/solana-foundation/anchor avm --locked
avm install 1.2.0 && avm use 1.2.0

# 3. Сборка, тесты, деплой (из корня репозитория)
npm install
anchor build && anchor keys sync && anchor build   # подставит свои program id
anchor test --provider.cluster localnet
anchor deploy --provider.cluster devnet
```

Подробности — в [docs/course/week-05-anchor-counter.md](docs/course/week-05-anchor-counter.md).

## Тесты

```bash
cd backend
npm test        # vitest run
```

31 тест, всё **чистая логика, без обращения к БД и к сети** (и потому
быстрая/детерминированная):

- `tests/dna.test.ts` — один и тот же seed всегда даёт одну и ту же ДНК;
  разные seed дают разную ДНК (200 сэмплов); части тела совместимы только
  со своим архетипом (BIRD никогда не получает legs, AQUATIC — wings);
  body params всегда в `[0.8, 1.2]`; распределение редкости на 3000
  сэмплах статистически смещено к Common (по убыванию до Mythic).
- `tests/economy.test.ts` — цена минта всегда в `[MIN_PRICE_SOL,
  MAX_PRICE_SOL]`; растёт с ростом спроса/предложения; чистая функция.
- `tests/color.test.ts` — палитра всегда валидные hex-цвета; разные
  harmony дают разные вторичные оттенки; детерминированность.
- `tests/leveling.test.ts` — XP-пороги уровней 1–5 совпадают с
  дизайн-таблицей из ТЗ; `levelFromXp`/`xpForLevel` — точные обратные
  функции на 20 уровнях.
- `tests/txDetective.test.ts` — Transaction Detective на двух сохранённых
  реальных devnet-транзакциях (оплата минта и Metaplex `createNft`):
  аккаунты, дерево CPI, разбор комиссии, пересчёт PDA.
- `tests/auth.test.ts` — вход через Phantom: формат SIWS-сообщения,
  проверка ed25519-подписи (чужой ключ, изменённый текст, мусор — отказ),
  привязка к разрешённому origin, хранение токена только в виде sha256.

Rust: `cd crates/petdna && cargo test` (22 теста, включая сверку с
TypeScript-генератором на 210 векторах) и `cd native/pet_passport && cargo test`
(7 тестов логики программы). Anchor-программы: `anchor test`, см. выше.

**Честно не покрыто тестами** (см. [Что дальше](#что-дальше)): anti-bot
лимиты, инвентарь, маркетплейс — эти сервисы пишут в реальную БД, и
полноценные интеграционные тесты для них нужно гонять на отдельной
тестовой базе, чтобы не заводить моки там, где легче и честнее иметь
настоящую БД — это осознанно оставлено на следующий шаг, а не подделано
ради галочки в покрытии.

## API reference

Базовый URL: `http://localhost:4000/api`

Все `POST`-запросы, кроме `/auth/*`, требуют `Authorization: Bearer <token>`
от входа через Phantom, а кошелёк в теле запроса должен совпадать с
кошельком сессии (см. [Вход через Phantom](#вход-через-phantom-sign-in-with-solana)).

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/nonce` | Сообщение для подписи `{wallet}` → `{nonce, message, expiresAt}` |
| POST | `/auth/verify` | Проверить подпись `{wallet, nonce, signature(base64)}` → `{token, wallet, expiresAt}` |
| GET | `/auth/session` | Текущая сессия (Bearer) → `{wallet}` |
| POST | `/auth/logout` | Отозвать токен (Bearer) |
| GET | `/health` | Health check |
| GET | `/items` | Полный каталог предметов |
| GET | `/economy/mint-price` | Текущая динамическая цена минта + treasury-адрес |
| POST | `/pets/mint` | Оплатить и заминтить питомца `{ownerWallet, name, type, color, paymentTxSignature}` |
| GET | `/pets/:id` | Получить одного питомца |
| GET | `/pets/wallet/:wallet` | Список питомцев кошелька |
| POST | `/pets/:id/feed` | Действие Feed `{ownerWallet}` |
| POST | `/pets/:id/play` | Действие Play `{ownerWallet}` |
| POST | `/pets/:id/rest` | Действие Rest `{ownerWallet}` |
| POST | `/pets/:id/train` | Действие Train `{ownerWallet, stat: "strength"\|"speed"}` |
| POST | `/pets/:id/equip` | Экипировать/снять аксессуар `{ownerWallet, itemKey\|null}` |
| POST | `/pets/:id/mint` | Записать завершённый клиентский **NFT**-минт `{ownerWallet, mintAddress, metadataUri}` |
| GET | `/metadata/:id` | JSON метаданных NFT питомца в стандарте Metaplex |
| GET | `/games` | Каталог мини-игр |
| POST | `/games/:id/complete` | Завершить сессию мини-игры `{wallet, score, petId?}` |
| GET | `/quests?wallet=` | Список квестов с прогрессом для кошелька |
| POST | `/quests/:id/complete` | Забрать награду за квест `{wallet}` |
| GET | `/inventory/:wallet` | Инвентарь кошелька |
| POST | `/inventory/use` | Использовать предмет `{ownerWallet, petId, itemKey}` |
| GET | `/marketplace` | Активные листинги (фильтры: `type`, `rarity`, `minPrice`, `maxPrice`, `minLevel`) |
| POST | `/marketplace/list` | Выставить питомца `{sellerWallet, petId, priceSol}` |
| POST | `/marketplace/:id/cancel` | Отменить листинг `{sellerWallet}` |
| POST | `/marketplace/buy` | Купить листинг `{buyerWallet, listingId}` |
| GET | `/leaderboard` | Топ питомцев по уровню/XP |
| GET | `/user/:wallet` | Полный профиль (пользователь, питомцы, инвентарь, счётчики) |
| GET | `/daily-reward/:wallet` | Доступность ежедневной награды |
| POST | `/daily-reward/claim` | Забрать награду `{walletAddress}` |

> Примечание: в ТЗ были перечислены `GET /api/pets/:wallet` и `GET
> /api/pets/:id` как отдельные роуты, но как записаны — они конфликтуют
> (оба — один сегмент пути). Решено как `GET /pets/wallet/:wallet` против
> `GET /pets/:id`. Также в ТЗ значился один `POST /api/pets/mint` — в
> этом репозитории под этим путём — именно оплаченное **создание**
> питомца; отдельный, второй смысл "минта" из ТЗ (§13, превращение
> готового питомца в NFT) вынесен в `POST /pets/:id/mint`, поскольку это
> технически совершенно разные операции (создание записи в БД после
> проверки SOL-платежа vs. создание NFT-аккаунтов в Metaplex) — см.
> doc-комментарии в `petService.ts`.

## MVP / заглушки

Честно о том, что упрощено и почему:

- **Сессия — bearer-токен в `localStorage`.** Вход по подписи кошелька
  настоящий (см. [Вход через Phantom](#вход-через-phantom-sign-in-with-solana)),
  но токен хранится в `localStorage` браузера. В продакшене лучше
  `httpOnly`-cookie и ограничение частоты запросов к `/auth/nonce`.
- **Только оплата минта проверяется на цепочке по-настоящему.** Покупка
  на Marketplace комиссии считает по-настоящему (`computeSaleBreakdown`),
  но **не двигает реальный SOL** — как и раньше, нужна ончейн-программа
  или эскроу для атомарного обмена SOL↔NFT.
- **Визуал питомца — процедурный цвет, не per-part спрайты.** ДНК/traits/
  аура реальны и хранятся/используются в метаданных, но не рендерятся из
  отдельных PNG/SVG-частей с масками — см.
  [Генерация DNA](#генерация-dna-и-prng).
- **Реализовано 2 из 4 мини-игр** (Reaction, Memory) — Catch и
  специализированная Training-игра не сделаны, а не подделаны под тем же
  API.
- **Anchor-программа `petnft` приложением не используется** (собрана и
  проверена на локальном валидаторе), оплата минта и marketplace foundation
  из ТЗ §30 в ней не реализованы — вся проверка сейчас на backend'е напрямую через RPC.
  См. [Solana-программа](#solana-программа-anchor).
- **Anti-cheat мини-игр минимален** — сервер ограничивает частоту и
  диапазон очков, но не может полностью проверить, что присланный `score`
  честный (нужен был бы серверный replay игрового ввода).
- **Изменяемые характеристики питомца живут в базе данных, а не в
  блокчейне** — осознанное решение, см. [Архитектуру](#архитектура);
  соответствует явному допущению ТЗ.
- **Инвентарь/anti-bot/marketplace не покрыты автотестами** — см.
  [Тесты](#тесты).

## Что дальше

- Настоящая эскроу-программа / атомарный своп SOL↔NFT для маркетплейса,
  и перенос проверки оплаты минта в сам Anchor-контракт (единая атомарная
  транзакция вместо связки "оплата → backend проверяет → создаёт запись")
- Per-part спрайт-рендеринг питомца по DNA (реальные PNG/SVG-ассеты + маски)
  вместо процедурного цветового портрета
- Catch и Training мини-игры, более надёжный анти-чит для очков
- Интеграционные тесты для anti-bot/инвентаря/маркетплейса на отдельной
  тестовой БД
- Разведение (breeding) питомцев, PvP, гильдии, турниры, ивенты
- PostgreSQL в продакшене (схема уже портируемая — см.
  `backend/prisma/schema.prisma`)
