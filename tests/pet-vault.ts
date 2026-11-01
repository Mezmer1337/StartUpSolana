import * as anchor from "@anchor-lang/core";
import { AnchorError, BN, Program } from "@anchor-lang/core";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";
import type { PetVault } from "../target/types/pet_vault";
import { loadKeypair } from "../clients/common";
import { assetsForShares, sharesForAssets, vaultAddresses } from "../clients/pet-vault-math";
import { createPetcoinMint, mintPetcoin } from "../clients/petcoin-core";
import { testProvider } from "./utils";

const TOKENS = (n: number) => BigInt(n) * 1_000_000n; // 6 decimals
const bn = (value: bigint) => new BN(value.toString());

describe("pet_vault", () => {
  const provider = testProvider();
  anchor.setProvider(provider);
  const program = anchor.workspace.petVault as Program<PetVault>;
  const conn = provider.connection;
  const payer = loadKeypair();

  // A second player; tokens and SOL come from the main wallet, so the suite runs on devnet too.
  const player = Keypair.generate();
  const asPlayer = new Program<PetVault>(program.idl, testProvider(new anchor.Wallet(player)));

  async function expectError(promise: Promise<unknown>, expected: string) {
    try {
      await promise;
    } catch (err) {
      const text = err instanceof AnchorError ? err.error.errorCode.code : String(err) + JSON.stringify((err as any).logs ?? []);
      expect(text).to.include(expected);
      return;
    }
    assert.fail(`expected an error containing ${expected}`);
  }

  const balance = async (account: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) =>
    (await getAccount(conn, account, "confirmed", tokenProgram)).amount;

  /** A fresh mint per run, so a fresh vault: the suite works against a persistent cluster. */
  let mint: PublicKey;
  let v: ReturnType<typeof vaultAddresses>;
  let myTokens: PublicKey;
  let playerTokens: PublicKey;
  const sharesOf = (owner: PublicKey) => getAssociatedTokenAddressSync(v.shareMint, owner);

  const deposit = (amount: bigint, minShares = 0n, as = program, user = provider.publicKey, userTokens = myTokens) =>
    as.methods.deposit(bn(amount), bn(minShares)).accounts({ user, assetMint: mint, userTokens, tokenProgram: TOKEN_PROGRAM_ID }).rpc();

  const withdraw = (shares: bigint, minAssets = 0n, as = program, user = provider.publicKey, userTokens = myTokens) =>
    as.methods
      .withdraw(bn(shares), bn(minAssets))
      .accounts({ user, assetMint: mint, userTokens, userShares: sharesOf(user), tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

  before(async () => {
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: provider.publicKey, toPubkey: player.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
      ),
    );
    mint = await createMint(conn, payer, payer.publicKey, null, 6, undefined, { commitment: "confirmed" });
    v = vaultAddresses(program.programId, mint, TOKEN_PROGRAM_ID);
    myTokens = await createAssociatedTokenAccountIdempotent(conn, payer, mint, payer.publicKey, { commitment: "confirmed" });
    playerTokens = await createAssociatedTokenAccountIdempotent(conn, payer, mint, player.publicKey, { commitment: "confirmed" });
    await mintTo(conn, payer, mint, myTokens, payer, TOKENS(1_000), [], { commitment: "confirmed" });
    await mintTo(conn, payer, mint, playerTokens, payer, TOKENS(1_000), [], { commitment: "confirmed" });
  });

  it("creates the vault: state PDA, share mint PDA and token account owned by the vault PDA", async () => {
    await program.methods.initializeVault().accounts({ payer: provider.publicKey, assetMint: mint, tokenProgram: TOKEN_PROGRAM_ID }).rpc();

    const vault = await program.account.vault.fetch(v.address);
    expect(vault.assetMint.toBase58()).to.equal(mint.toBase58());
    expect(vault.shareMint.toBase58()).to.equal(v.shareMint.toBase58());
    expect(vault.vaultTokens.toBase58()).to.equal(v.vaultTokens.toBase58());

    const shareMint = await getMint(conn, v.shareMint, "confirmed");
    expect(shareMint.mintAuthority!.toBase58()).to.equal(v.address.toBase58()); // only the program can mint shares
    expect(shareMint.decimals).to.equal(6);
    expect((await getAccount(conn, v.vaultTokens, "confirmed")).owner.toBase58()).to.equal(v.address.toBase58());
  });

  it("allows one vault per mint", async () => {
    await expectError(
      program.methods.initializeVault().accounts({ payer: provider.publicKey, assetMint: mint, tokenProgram: TOKEN_PROGRAM_ID }).rpc(),
      "already in use",
    );
  });

  it("first deposit mints shares 1:1", async () => {
    await deposit(TOKENS(100));
    expect(await balance(v.vaultTokens)).to.equal(TOKENS(100));
    expect(await balance(sharesOf(provider.publicKey))).to.equal(TOKENS(100));
    expect(await balance(myTokens)).to.equal(TOKENS(900));
  });

  it("rewards sent to the vault raise the price of a share", async () => {
    // A plain transfer, not a program call: 50 tokens of "game rewards" for the share holders.
    await provider.sendAndConfirm(
      new Transaction().add(createTransferCheckedInstruction(myTokens, mint, v.vaultTokens, provider.publicKey, TOKENS(50), 6)),
    );

    // The player now buys in at 1.5 tokens per share: 150 tokens -> ~100 shares.
    const expected = sharesForAssets(TOKENS(150), TOKENS(150), TOKENS(100));
    await deposit(TOKENS(150), expected, asPlayer, player.publicKey, playerTokens);
    const playerShares = await balance(sharesOf(player.publicKey));
    expect(playerShares).to.equal(expected);
    // Within 0.001 token: the 1000 virtual shares/assets shift the rate by a few ppm.
    expect(Number(playerShares)).to.be.closeTo(Number(TOKENS(100)), 1_000);
  });

  it("withdraw burns shares and pays out through a CPI signed by the vault PDA", async () => {
    const [totalAssets, supply] = [await balance(v.vaultTokens), (await getMint(conn, v.shareMint, "confirmed")).supply];
    const shares = TOKENS(40);
    const expected = assetsForShares(shares, totalAssets, supply); // ~60: the 40 shares earned their part of the reward
    const before = await balance(myTokens);

    await withdraw(shares, expected);

    expect((await balance(myTokens)) - before).to.equal(expected);
    expect(Number(expected)).to.be.closeTo(Number(TOKENS(60)), 1_000);
    expect(await balance(sharesOf(provider.publicKey))).to.equal(TOKENS(60));
    expect((await getMint(conn, v.shareMint, "confirmed")).supply).to.equal(supply - shares);
  });

  it("enforces the caller's minimum on deposit and withdraw (slippage)", async () => {
    await expectError(deposit(TOKENS(10), TOKENS(10)), "SlippageExceeded"); // 10 tokens buy < 10 shares now
    await expectError(withdraw(TOKENS(10), TOKENS(16)), "SlippageExceeded"); // 10 shares are worth ~15
  });

  it("rejects zero amounts and deposits too small for one share unit", async () => {
    await expectError(deposit(0n), "ZeroAmount");
    await expectError(withdraw(0n), "ZeroAmount");
    await expectError(deposit(1n), "ZeroShares"); // 1 raw unit at 1.5 tokens/share rounds to 0 shares
  });

  it("cannot withdraw more shares than owned", async () => {
    await expectError(withdraw(TOKENS(61)), "insufficient funds");
  });

  it("a stranger cannot burn someone else's shares", async () => {
    await expectError(
      asPlayer.methods
        .withdraw(bn(TOKENS(1)), bn(0n))
        .accounts({
          user: player.publicKey,
          assetMint: mint,
          userTokens: playerTokens,
          userShares: sharesOf(provider.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ConstraintTokenOwner",
    );
  });

  it("a fake vault token account is refused (has_one)", async () => {
    await expectError(
      program.methods
        .withdraw(bn(TOKENS(1)), bn(0n))
        .accountsPartial({
          user: provider.publicKey,
          assetMint: mint,
          vaultTokens: playerTokens,
          userTokens: myTokens,
          userShares: sharesOf(provider.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
      "ConstraintHasOne",
    );
  });

  it("everyone withdraws everything; rounding leaves only dust in the vault", async () => {
    await withdraw(await balance(sharesOf(provider.publicKey)));
    await withdraw(await balance(sharesOf(player.publicKey)), 0n, asPlayer, player.publicKey, playerTokens);
    expect((await getMint(conn, v.shareMint, "confirmed")).supply).to.equal(0n);
    const dust = await balance(v.vaultTokens);
    expect(dust < 1_000n, `dust ${dust}`).to.equal(true);
    expect((await balance(myTokens)) + (await balance(playerTokens)) + dust).to.equal(TOKENS(2_000));
  });

  it("PETCOIN (Token-2022, 1% transfer fee): shares are minted for what actually arrived", async () => {
    const { mint: pet } = await createPetcoinMint(conn, payer, payer.publicKey);
    const pv = vaultAddresses(program.programId, pet, TOKEN_2022_PROGRAM_ID);
    const { ata } = await mintPetcoin(conn, payer, payer, pet, payer.publicKey, TOKENS(500));
    await program.methods.initializeVault().accounts({ payer: provider.publicKey, assetMint: pet, tokenProgram: TOKEN_2022_PROGRAM_ID }).rpc();

    await program.methods
      .deposit(bn(TOKENS(100)), bn(0n))
      .accounts({ user: provider.publicKey, assetMint: pet, userTokens: ata, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .rpc();

    // 1 PET is withheld by Token-2022 on the vault's account, so only 99 count.
    const shares = getAssociatedTokenAddressSync(pv.shareMint, provider.publicKey, false, TOKEN_2022_PROGRAM_ID);
    expect(await balance(shares, TOKEN_2022_PROGRAM_ID)).to.equal(TOKENS(99));
    expect((await program.account.vault.fetch(pv.address)).totalDeposited.toString()).to.equal(TOKENS(99).toString());

    // Withdrawing all 99 shares sends 99 PET; the fee is withheld again on the way out.
    await program.methods
      .withdraw(bn(TOKENS(99)), bn(TOKENS(99)))
      .accounts({ user: provider.publicKey, assetMint: pet, userTokens: ata, userShares: shares, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .rpc();
    expect(await balance(ata, TOKEN_2022_PROGRAM_ID)).to.equal(TOKENS(400) + TOKENS(99) - 990_000n);
  });
});
