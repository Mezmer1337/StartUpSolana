/**
 * Тесты для Simple Vault на devnet
 *
 * Сценарий:
 *   1. Admin создаёт vault (initialize_vault): fee_wallet = admin, min_deposit = 1 токен, paused = false
 *   2. Пользователи A и B создают свои карточки (create_user_card)
 *   3. Повторное создание карточки A падает
 *   4. A вносит 100 токенов → 1 токен комиссии админу, 99 shares; B вносит 50 → 49.5 shares
 *   5. Депозит без карточки, депозит 0 и депозит меньше минимума — ошибки
 *   6. A возвращает 50 shares → получает 50 токенов, B выводит всё
 *   7. Вывод 0, вывод больше своих shares и вывод без карточки — ошибки
 *
 * Задания для практики:
 *   1. комиссия 1% на fee_wallet, set_fee_wallet (только админ)
 *   2. минимальный депозит 1 токен
 *   3. set_paused: депозиты стоят, вывод работает
 *   4. трое пользователей вносят разные суммы — доли по shares (отдельный vault)
 *   5. withdraw_all
 *   6. close_user_card: нельзя с shares, без shares — рента возвращается
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, createAccount, mintTo, getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

// Переводим SOL от admin → pubkey (обходит rate limit devnet airdrop)
async function fundFromAdmin(
  provider: anchor.AnchorProvider,
  admin: Keypair,
  pubkey: PublicKey,
  lamports = 0.05 * LAMPORTS_PER_SOL
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pubkey, lamports })
  );
  await provider.sendAndConfirm(tx, [admin]);
}

const UNIT = 1_000_000; // decimals = 6
/** Комиссия 1% с депозита — та же формула, что deposit_fee в lib.rs (округление вниз) */
const fee = (amount: number) => Math.floor((amount * 100) / 10_000);
const net = (amount: number) => amount - fee(amount);

// Ждём, что вызов упадёт с конкретной ошибкой (по имени ошибки или по тексту в логах)
async function expectError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e: any) {
    const text = `${e?.error?.errorCode?.code ?? ""} ${e?.message ?? ""} ${(e?.logs ?? []).join(" ")}`;
    assert.include(text, code, `ожидали ошибку ${code}, получили: ${text.slice(0, 300)}`);
    return;
  }
  assert.fail(`ожидали ошибку ${code}, но вызов прошёл`);
}

describe("simple_vault", () => {
  // commitment "confirmed", как в tests/raydium.ts: оба файла делят одну программу из anchor.workspace,
  // и с "processed" созданный здесь токен может быть ещё не виден ноде, через которую идёт вызов программы
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(new Connection(env.connection.rpcEndpoint, "confirmed"), env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  /** Один vault со всеми PDA — в файле их два: основной и для задания 4 */
  interface VaultCtx {
    mint: PublicKey;
    state: PublicKey;
    tokens: PublicKey;
    shareMint: PublicKey;
    feeAcc: PublicKey; // токен-аккаунт fee_wallet (по умолчанию — админа)
  }

  // Токен-аккаунты (токен vault) и share-аккаунты пользователей
  const tokenAcc: Record<string, PublicKey> = {};
  const shareAcc: Record<string, PublicKey> = {};
  const key = (user: Keypair) => user.publicKey.toBase58();

  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const cardPda = (v: VaultCtx, user: PublicKey) =>
    pda(Buffer.from("user_card"), v.state.toBuffer(), user.toBuffer());

  /** Новый токен + vault для него; комиссия — на ATA админа */
  async function newVault(): Promise<VaultCtx> {
    const mint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const v: VaultCtx = {
      mint,
      state: pda(Buffer.from("vault"), mint.toBuffer()),
      tokens: pda(Buffer.from("vault_tokens"), mint.toBuffer()),
      shareMint: pda(Buffer.from("share_mint"), mint.toBuffer()),
      feeAcc: (await getOrCreateAssociatedTokenAccount(provider.connection, admin, mint, admin.publicKey)).address,
    };
    await program.methods
      .initializeVault()
      .accounts({
        vaultState: v.state,
        vaultTokenAccount: v.tokens,
        shareMint: v.shareMint,
        tokenMint: mint,
        admin: admin.publicKey,
      } as any)
      .rpc();
    return v;
  }

  /** Токен-аккаунт и share-аккаунт пользователя + стартовые токены */
  async function fundUser(v: VaultCtx, user: Keypair, tokens = 1000 * UNIT) {
    tokenAcc[key(user)] = await createAccount(provider.connection, admin, v.mint, user.publicKey);
    shareAcc[key(user)] = await createAccount(provider.connection, admin, v.shareMint, user.publicKey);
    await mintTo(provider.connection, admin, v.mint, tokenAcc[key(user)], admin, tokens);
  }

  const createCard = (v: VaultCtx, user: Keypair) =>
    program.methods
      .createUserCard()
      .accounts({ vaultState: v.state, userCard: cardPda(v, user.publicKey), user: user.publicKey } as any)
      .signers([user])
      .rpc();

  const deposit = (v: VaultCtx, user: Keypair, amount: number, feeAcc = v.feeAcc) =>
    program.methods
      .deposit(new anchor.BN(amount))
      .accounts({
        vaultState: v.state,
        userCard: cardPda(v, user.publicKey),
        vaultTokenAccount: v.tokens,
        shareMint: v.shareMint,
        userTokenAccount: tokenAcc[key(user)],
        userShareAccount: shareAcc[key(user)],
        feeTokenAccount: feeAcc,
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();

  const withdrawAccounts = (v: VaultCtx, user: Keypair) => ({
    vaultState: v.state,
    userCard: cardPda(v, user.publicKey),
    vaultTokenAccount: v.tokens,
    shareMint: v.shareMint,
    userTokenAccount: tokenAcc[key(user)],
    userShareAccount: shareAcc[key(user)],
    user: user.publicKey,
  });

  const withdraw = (v: VaultCtx, user: Keypair, sharesAmount: number) =>
    program.methods
      .withdraw(new anchor.BN(sharesAmount))
      .accounts(withdrawAccounts(v, user) as any)
      .signers([user])
      .rpc();

  const withdrawAll = (v: VaultCtx, user: Keypair) =>
    program.methods
      .withdrawAll()
      .accounts(withdrawAccounts(v, user) as any)
      .signers([user])
      .rpc();

  const closeCard = (v: VaultCtx, user: Keypair) =>
    program.methods
      .closeUserCard()
      .accounts({
        vaultState: v.state,
        userCard: cardPda(v, user.publicKey),
        userShareAccount: shareAcc[key(user)],
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();

  const setPaused = (v: VaultCtx, paused: boolean, signer: Keypair = admin) =>
    program.methods
      .setPaused(paused)
      .accounts({ admin: signer.publicKey, vaultState: v.state } as any)
      .signers(signer === admin ? [] : [signer])
      .rpc();

  const setFeeWallet = (v: VaultCtx, wallet: PublicKey, signer: Keypair = admin) =>
    program.methods
      .setFeeWallet(wallet)
      .accounts({ admin: signer.publicKey, vaultState: v.state } as any)
      .signers(signer === admin ? [] : [signer])
      .rpc();

  const balance = async (acc: PublicKey) => (await getAccount(provider.connection, acc)).amount;
  const fetchVault = (v: VaultCtx) => program.account.vaultState.fetch(v.state);

  // ─── основной vault ────────────────────────────────────────────────────────

  describe("основной сценарий + задания 1, 2, 3, 5, 6", () => {
    const userA = Keypair.generate();
    const userB = Keypair.generate();
    const userC = Keypair.generate(); // без карточки
    let v: VaultCtx;

    before(async () => {
      for (const u of [userA, userB, userC]) await fundFromAdmin(provider, admin, u.publicKey);
    });

    it("initialize_vault: vault создан, комиссия — админу, минимум 1 токен, не на паузе", async () => {
      v = await newVault();

      const vault = await fetchVault(v);
      assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
      assert.equal(vault.tokenMint.toBase58(), v.mint.toBase58());
      assert.equal(vault.shareMint.toBase58(), v.shareMint.toBase58());
      assert.equal(vault.feeWallet.toBase58(), admin.publicKey.toBase58());
      assert.equal(vault.minDeposit.toNumber(), 1 * UNIT);
      assert.isFalse(vault.paused);
    });

    it("create_user_card: у каждого пользователя своя карточка", async () => {
      for (const user of [userA, userB]) {
        await createCard(v, user);
        const card = await program.account.userCard.fetch(cardPda(v, user.publicKey));
        assert.equal(card.owner.toBase58(), user.publicKey.toBase58());
        assert.equal(card.vault.toBase58(), v.state.toBase58());
      }
      assert.notEqual(cardPda(v, userA.publicKey).toBase58(), cardPda(v, userB.publicKey).toBase58());
    });

    it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
      await expectError(() => createCard(v, userA), "already in use");
    });

    it("задание 1. deposit: A вносит 100 → 1 токен комиссии на fee_wallet, 99 shares", async () => {
      for (const user of [userA, userB, userC]) await fundUser(v, user);
      const feeBefore = await balance(v.feeAcc);

      await deposit(v, userA, 100 * UNIT);

      assert.equal(await balance(shareAcc[key(userA)]), BigInt(99 * UNIT));
      assert.equal((await balance(v.feeAcc)) - feeBefore, BigInt(1 * UNIT));
      assert.equal(await balance(tokenAcc[key(userA)]), BigInt(900 * UNIT)); // списано 100 целиком
      assert.equal(await balance(v.tokens), BigInt(99 * UNIT));

      const card = await program.account.userCard.fetch(cardPda(v, userA.publicKey));
      assert.equal(card.deposited.toNumber(), 99 * UNIT); // в карточке — то, что легло в vault
      assert.equal(card.shares.toNumber(), 99 * UNIT);
    });

    it("задание 1. deposit: B вносит 50 → 49.5 shares", async () => {
      await deposit(v, userB, 50 * UNIT);

      assert.equal(await balance(shareAcc[key(userB)]), BigInt(net(50 * UNIT)));

      const vault = await fetchVault(v);
      assert.equal(vault.totalTokens.toNumber(), net(100 * UNIT) + net(50 * UNIT)); // 148.5
      assert.equal(vault.totalShares.toNumber(), net(100 * UNIT) + net(50 * UNIT));
      assert.equal(await balance(v.tokens), BigInt(net(100 * UNIT) + net(50 * UNIT)));
    });

    it("задание 1. deposit: аккаунт комиссии не fee_wallet — ошибка", async () => {
      // токен-аккаунт пользователя вместо аккаунта админа
      await expectError(() => deposit(v, userA, 10 * UNIT, tokenAcc[key(userB)]), "ConstraintTokenOwner");
    });

    it("задание 1. set_fee_wallet: не админ — ошибка; админ меняет кошелёк комиссии", async () => {
      await expectError(() => setFeeWallet(v, userB.publicKey, userB), "Unauthorized");

      // Комиссия теперь идёт на токен-аккаунт userC
      await setFeeWallet(v, userC.publicKey);
      assert.equal((await fetchVault(v)).feeWallet.toBase58(), userC.publicKey.toBase58());
      await expectError(() => deposit(v, userA, 10 * UNIT), "ConstraintTokenOwner"); // старый аккаунт

      const before = await balance(tokenAcc[key(userC)]);
      await deposit(v, userA, 10 * UNIT, tokenAcc[key(userC)]);
      assert.equal((await balance(tokenAcc[key(userC)])) - before, BigInt(fee(10 * UNIT)));

      // Возвращаем как было, чтобы дальше считалось просто
      await setFeeWallet(v, admin.publicKey);
      // и выводим эти 10 обратно — суммы ниже считаются от 100 + 50
      await withdraw(v, userA, net(10 * UNIT));
    });

    it("deposit: без карточки — ошибка", async () => {
      await expectError(() => deposit(v, userC, 10 * UNIT), "AccountNotInitialized");
    });

    it("deposit: сумма 0 — ошибка", async () => {
      await expectError(() => deposit(v, userA, 0), "ZeroAmount");
    });

    it("задание 2. deposit: меньше 1 токена — ошибка DepositTooSmall, ровно 1 токен — можно", async () => {
      await expectError(() => deposit(v, userA, UNIT / 2), "DepositTooSmall");
      await expectError(() => deposit(v, userA, UNIT - 1), "DepositTooSmall");

      await deposit(v, userA, 1 * UNIT);
      await withdraw(v, userA, net(1 * UNIT)); // вернуть как было
    });

    it("задание 3. set_paused: не админ — ошибка", async () => {
      await expectError(() => setPaused(v, true, userA), "Unauthorized");
    });

    it("задание 3. на паузе депозит — VaultPaused, а вывод работает", async () => {
      await setPaused(v, true);
      assert.isTrue((await fetchVault(v)).paused);

      await expectError(() => deposit(v, userA, 10 * UNIT), "VaultPaused");

      const before = await balance(tokenAcc[key(userA)]);
      await withdraw(v, userA, 1 * UNIT);
      assert.equal((await balance(tokenAcc[key(userA)])) - before, BigInt(1 * UNIT));

      // Снимаем паузу — депозит снова проходит
      await setPaused(v, false);
      assert.isFalse((await fetchVault(v)).paused);
      await deposit(v, userA, 10 * UNIT);
      await withdraw(v, userA, net(10 * UNIT) - 1 * UNIT); // A снова с 99 shares
      assert.equal(await balance(shareAcc[key(userA)]), BigInt(99 * UNIT));
    });

    it("withdraw: A возвращает 50 shares → получает 50 токенов", async () => {
      const before = await balance(tokenAcc[key(userA)]);
      await withdraw(v, userA, 50 * UNIT);

      assert.equal((await balance(tokenAcc[key(userA)])) - before, BigInt(50 * UNIT));
      assert.equal(await balance(shareAcc[key(userA)]), BigInt(49 * UNIT));

      const vault = await fetchVault(v);
      // в vault 148.5 токенов на 148.5 shares — курс 1:1, комиссия его не меняет
      assert.equal(vault.totalTokens.toNumber(), net(100 * UNIT) + net(50 * UNIT) - 50 * UNIT);
      assert.equal(vault.totalShares.toNumber(), vault.totalTokens.toNumber());
    });

    it("задание 5. withdraw_all: B выводит всё одной инструкцией", async () => {
      const before = await balance(tokenAcc[key(userB)]);
      await withdrawAll(v, userB);

      assert.equal((await balance(tokenAcc[key(userB)])) - before, BigInt(net(50 * UNIT)));
      assert.equal(await balance(shareAcc[key(userB)]), BigInt(0));
      const card = await program.account.userCard.fetch(cardPda(v, userB.publicKey));
      assert.equal(card.shares.toNumber(), 0);

      const vault = await fetchVault(v);
      assert.equal(vault.totalTokens.toNumber(), 49 * UNIT);
      assert.equal(vault.totalShares.toNumber(), 49 * UNIT);
    });

    it("задание 5. withdraw_all без shares — ZeroAmount", async () => {
      await expectError(() => withdrawAll(v, userB), "ZeroAmount");
    });

    it("withdraw: сумма 0 — ошибка", async () => {
      await expectError(() => withdraw(v, userA, 0), "ZeroAmount");
    });

    it("withdraw: больше своих shares — ошибка", async () => {
      // shares сжигаются раньше перевода: у A 49 shares, token program откажет
      await expectError(() => withdraw(v, userA, 50 * UNIT), "insufficient funds");
    });

    it("withdraw: без карточки — ошибка", async () => {
      await expectError(() => withdraw(v, userC, 1 * UNIT), "AccountNotInitialized");
    });

    it("задание 6. close_user_card: пока есть shares — CardHasShares", async () => {
      await expectError(() => closeCard(v, userA), "CardHasShares");
    });

    it("задание 6. close_user_card: без shares карточка закрыта, рента вернулась", async () => {
      const card = cardPda(v, userB.publicKey);
      const rent = (await provider.connection.getAccountInfo(card))!.lamports;
      const before = await provider.connection.getBalance(userB.publicKey);

      await closeCard(v, userB);

      assert.isNull(await provider.connection.getAccountInfo(card));
      const after = await provider.connection.getBalance(userB.publicKey);
      // комиссию сети платит admin (fee payer провайдера), поэтому пользователю вернулась вся рента
      assert.equal(after - before, rent);

      // Карточку можно создать заново
      await createCard(v, userB);
    });
  });

  // ─── задание 4: трое пользователей ─────────────────────────────────────────

  describe("задание 4. трое пользователей вносят разные суммы", () => {
    const users = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const amounts = [100 * UNIT, 250 * UNIT, 650 * UNIT]; // всего 1000
    let v: VaultCtx;

    before(async () => {
      v = await newVault();
      for (const u of users) {
        await fundFromAdmin(provider, admin, u.publicKey);
        await fundUser(v, u);
        await createCard(v, u);
      }
    });

    it("shares пропорциональны внесённому: 10% / 25% / 65%", async () => {
      for (let i = 0; i < users.length; i++) await deposit(v, users[i], amounts[i]);

      const vault = await fetchVault(v);
      const totalShares = BigInt(vault.totalShares.toString());
      const totalIn = amounts.reduce((a, b) => a + b, 0);
      assert.equal(totalShares, BigInt(amounts.map(net).reduce((a, b) => a + b, 0)));

      for (let i = 0; i < users.length; i++) {
        const shares = await balance(shareAcc[key(users[i])]);
        assert.equal(shares, BigInt(net(amounts[i])), `shares пользователя ${i + 1}`);
        // доля в shares = доля во внесённом (сравниваем крест-накрест, без дробей)
        assert.equal(shares * BigInt(totalIn), totalShares * BigInt(amounts[i]), `доля пользователя ${i + 1}`);
      }
      // соотношение 100 : 250 : 650 = 2 : 5 : 13
      const s = await Promise.all(users.map((u) => balance(shareAcc[key(u)])));
      assert.equal(s[0] * 5n, s[1] * 2n);
      assert.equal(s[0] * 13n, s[2] * 2n);
    });

    it("каждый выводит всё и получает ровно свою долю vault", async () => {
      const vaultTokens = await balance(v.tokens);
      const vault = await fetchVault(v);
      const totalShares = BigInt(vault.totalShares.toString());

      for (const u of users) {
        const shares = await balance(shareAcc[key(u)]);
        const expected = (shares * BigInt(vault.totalTokens.toString())) / totalShares;
        const before = await balance(tokenAcc[key(u)]);
        await withdrawAll(v, u);
        assert.equal((await balance(tokenAcc[key(u)])) - before, expected);
      }
      assert.equal(await balance(v.tokens), 0n);
      assert.equal(vaultTokens, BigInt(amounts.map(net).reduce((a, b) => a + b, 0)));
    });
  });
});
