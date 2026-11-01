// Client for programs/pet_vault (course tasks 9-10): deposit tokens for share tokens, withdraw through a PDA-signed CPI.
//
//   npm run vault -- init                                   create the vault for the mint (once per mint)
//   npm run vault -- show                                   balance, share supply, price per share, your position
//   npm run vault -- deposit --amount 100 [--slippage 50]   tokens -> vault, shares -> you
//   npm run vault -- withdraw --shares 40 [--slippage 50]   burn shares, tokens back (vault PDA signs the transfer)
//   npm run vault -- withdraw --all
//   npm run vault -- reward --amount 10                     send tokens straight to the vault: every share is worth more
//
// The mint is PETCOIN by default (--mint, PETCOIN_MINT, clients/.petcoin-mints.json, or the devnet PETCOIN);
// any SPL Token or Token-2022 mint works. --slippage is in basis points (50 = 0.5%).

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AnchorError, AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  TokenAccountNotFoundError,
  calculateEpochFee,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getTransferFeeConfig,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { PetVault } from "../target/types/pet_vault";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, RPC_URL } from "./common";
import { formatAmount, parseAmount } from "./petcoin-core";
import { assetsForShares, sharesForAssets, vaultAddresses, withSlippage } from "./pet-vault-math";

/** PETCOIN in devnet (docs/course/week-07-spl-token.md). */
const DEVNET_PETCOIN = "E3tAx6RP3T83PcQ5FRfxhtpdVo26icMTpeCMqwt7KunA";

function loadIdl() {
  const path = join(__dirname, "..", "target", "idl", "pet_vault.json");
  if (!existsSync(path)) {
    console.error(`IDL not found at ${path}. Run \`anchor build\` first (see docs/course/tasks-09-10-vault.md).`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function assetMint(): PublicKey {
  const file = join(__dirname, ".petcoin-mints.json");
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8"))[RPC_URL] : undefined;
  const address = option("mint") ?? process.env.PETCOIN_MINT ?? saved ?? (RPC_URL.includes("devnet") ? DEVNET_PETCOIN : undefined);
  if (!address) throw new Error(`No mint for ${RPC_URL}: pass --mint <address> or run \`npm run petcoin -- create\``);
  return new PublicKey(address);
}

const { command, option } = parseArgs();
const conn = connection();
const wallet = new Wallet(loadKeypair());
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
const program = new Program<PetVault>(loadIdl(), provider);
const user = wallet.publicKey;
const slippageBps = Number(option("slippage") ?? 50);

async function balance(tokenAccount: PublicKey, tokenProgram: PublicKey) {
  try {
    return (await getAccount(conn, tokenAccount, "confirmed", tokenProgram)).amount;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return 0n;
    throw err;
  }
}

async function state(mint: PublicKey) {
  const tokenProgram = (await conn.getAccountInfo(mint))!.owner;
  const a = vaultAddresses(program.programId, mint, tokenProgram);
  const vault = await program.account.vault.fetchNullable(a.address);
  if (!vault) throw new Error(`No vault for ${mint.toBase58()} yet (PDA ${a.address.toBase58()}). Run \`npm run vault -- init\`.`);
  const mintInfo = await getMint(conn, mint, "confirmed", tokenProgram);
  const shareMint = await getMint(conn, a.shareMint, "confirmed", tokenProgram);
  return {
    ...a,
    tokenProgram,
    vault,
    mintInfo,
    decimals: mintInfo.decimals,
    totalAssets: await balance(a.vaultTokens, tokenProgram),
    supply: shareMint.supply,
    userTokens: getAssociatedTokenAddressSync(mint, user, false, tokenProgram),
    userShares: getAssociatedTokenAddressSync(a.shareMint, user, false, tokenProgram),
  };
}

async function show(mint: PublicKey) {
  const s = await state(mint);
  const fmt = (raw: bigint) => formatAmount(raw, s.decimals);
  const myShares = await balance(s.userShares, s.tokenProgram);
  const one = 10n ** BigInt(s.decimals);
  console.log(`vault         ${s.address.toBase58()}   = PDA["vault", ${mint.toBase58()}]`);
  console.log(`share mint    ${s.shareMint.toBase58()}   = PDA["shares", vault]`);
  console.log(`vault tokens  ${s.vaultTokens.toBase58()}   = ATA(vault PDA, mint)`);
  console.log(`total assets  ${fmt(s.totalAssets)}   share supply ${fmt(s.supply)}`);
  console.log(`1 share       = ${fmt(assetsForShares(one, s.totalAssets, s.supply))} tokens`);
  console.log(`deposited     ${fmt(BigInt(s.vault.totalDeposited.toString()))} total · withdrawn ${fmt(BigInt(s.vault.totalWithdrawn.toString()))}`);
  console.log(`you           ${fmt(myShares)} shares ≈ ${fmt(assetsForShares(myShares, s.totalAssets, s.supply))} tokens · wallet ${fmt(await balance(s.userTokens, s.tokenProgram))}`);
  console.log(`explorer      ${explorerAddress(s.address)}`);
}

async function main() {
  const mint = assetMint();
  console.log(`RPC ${RPC_URL} · program ${program.programId.toBase58()} · wallet ${user.toBase58()}\n`);
  let signature: string;

  switch (command) {
    case "init": {
      const tokenProgram = (await conn.getAccountInfo(mint))!.owner;
      signature = await program.methods.initializeVault().accounts({ payer: user, assetMint: mint, tokenProgram }).rpc();
      break;
    }
    case "deposit": {
      const s = await state(mint);
      const amount = parseAmount(option("amount") ?? "", s.decimals);
      // Quote on what will arrive: a Token-2022 transfer fee (PETCOIN: 1%) is withheld on the way in.
      const feeConfig = getTransferFeeConfig(s.mintInfo);
      const fee = feeConfig ? calculateEpochFee(feeConfig, BigInt((await conn.getEpochInfo()).epoch), amount) : 0n;
      const minShares = withSlippage(sharesForAssets(amount - fee, s.totalAssets, s.supply), slippageBps);
      signature = await program.methods
        .deposit(new BN(amount.toString()), new BN(minShares.toString()))
        .accounts({ user, assetMint: mint, userTokens: s.userTokens, tokenProgram: s.tokenProgram })
        .rpc();
      break;
    }
    case "withdraw": {
      const s = await state(mint);
      const shares = option("all") !== undefined ? await balance(s.userShares, s.tokenProgram) : parseAmount(option("shares") ?? "", s.decimals);
      const minAssets = withSlippage(assetsForShares(shares, s.totalAssets, s.supply), slippageBps);
      // The ATA may have been closed; recreate it in the same transaction.
      const createAta = createAssociatedTokenAccountIdempotentInstruction(user, s.userTokens, user, mint, s.tokenProgram);
      signature = await program.methods
        .withdraw(new BN(shares.toString()), new BN(minAssets.toString()))
        .accounts({ user, assetMint: mint, userTokens: s.userTokens, userShares: s.userShares, tokenProgram: s.tokenProgram })
        .preInstructions([createAta])
        .rpc();
      break;
    }
    case "reward": {
      // Not a program instruction: a plain transfer into the vault's token account. The exchange rate is
      // total assets / share supply, so this raises the value of every share at once.
      const s = await state(mint);
      const amount = parseAmount(option("amount") ?? "", s.decimals);
      const tx = new Transaction().add(
        createTransferCheckedInstruction(s.userTokens, mint, s.vaultTokens, user, amount, s.decimals, [], s.tokenProgram),
      );
      signature = await provider.sendAndConfirm(tx);
      break;
    }
    case "show":
      await show(mint);
      return;
    default:
      console.log("Usage: npm run vault -- init|show|deposit|withdraw|reward  (see header of clients/pet-vault.ts)");
      process.exitCode = 1;
      return;
  }

  console.log(`tx ${explorerTx(signature)}\n`);
  await show(mint);
}

main().catch((err) => {
  if (err instanceof AnchorError) {
    console.error(`pet_vault error ${err.error.errorCode.code}: ${err.error.errorMessage}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
