// Client for PETCOIN, the PetNFT game token on Token-2022 (course week 7).
//
//   npm run petcoin -- create [--uri <metadata json url>]     new mint; its address is saved to clients/.petcoin-mints.json
//   npm run petcoin -- show                                   mint, supply, extensions, fee config, metadata
//   npm run petcoin -- mint --amount 1000 [--to <wallet>]     mint authority only
//   npm run petcoin -- transfer --to <wallet> --amount 25     TransferCheckedWithFee, 1% withheld
//   npm run petcoin -- balance [--wallet <address>]
//   npm run petcoin -- holders                                every PETCOIN token account + withheld fees
//   npm run petcoin -- meta --field description --value "…"   set any metadata field (name/symbol/uri/custom)
//   npm run petcoin -- meta --remove description              remove a custom field
//   npm run petcoin -- collect-fees                           harvest withheld fees and withdraw them to your account
//   npm run petcoin -- burn --amount 10
//
// Every command except create also takes --mint <address> (or PETCOIN_MINT) to work with another mint.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  TOKEN_2022_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getMetadataPointerState,
  getMint,
  getTransferFeeConfig,
  getTokenMetadata,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, RPC_URL } from "./common";
import {
  PETCOIN,
  balanceOf,
  burnPetcoin,
  collectPetcoinFees,
  createPetcoinMint,
  formatAmount,
  mintPetcoin,
  parseAmount,
  petcoinHolders,
  removePetcoinField,
  transferPetcoin,
  updatePetcoinField,
} from "./petcoin-core";

const MINTS_FILE = join(__dirname, ".petcoin-mints.json");

/** Mint address per RPC endpoint, so devnet and a local validator don't overwrite each other. */
function savedMints(): Record<string, string> {
  return existsSync(MINTS_FILE) ? JSON.parse(readFileSync(MINTS_FILE, "utf8")) : {};
}

const { command, option } = parseArgs();
const conn = connection();
const payer = loadKeypair();

function mintAddress(): PublicKey {
  const address = option("mint") ?? process.env.PETCOIN_MINT ?? savedMints()[RPC_URL];
  if (!address) {
    console.error(`No PETCOIN mint for ${RPC_URL}. Run \`npm run petcoin -- create\` or pass --mint <address>.`);
    process.exit(1);
  }
  return new PublicKey(address);
}

function requireAmount(): bigint {
  const amount = option("amount");
  if (!amount) throw new Error("--amount is required");
  return parseAmount(amount);
}

async function show(mint: PublicKey) {
  const info = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const extensions = getExtensionTypes(info.tlvData).map((type) => ExtensionType[type]);
  const fee = getTransferFeeConfig(info);
  const pointer = getMetadataPointerState(info);
  const metadata = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);

  console.log(`mint        ${mint.toBase58()}  (owner: Token-2022 ${TOKEN_2022_PROGRAM_ID.toBase58()})`);
  console.log(`supply      ${formatAmount(info.supply)} ${metadata?.symbol ?? ""}   decimals ${info.decimals}`);
  console.log(`authority   mint ${info.mintAuthority?.toBase58() ?? "— (fixed supply)"} · freeze ${info.freezeAuthority?.toBase58() ?? "—"}`);
  console.log(`extensions  ${extensions.join(", ")}`);
  if (fee) {
    const current = fee.newerTransferFee;
    console.log(
      `fee         ${current.transferFeeBasisPoints / 100}% (max ${formatAmount(current.maximumFee)} per transfer, from epoch ${current.epoch}) · ` +
        `withheld in mint ${formatAmount(fee.withheldAmount)}`,
    );
  }
  if (pointer) {
    const self = pointer.metadataAddress?.equals(mint);
    console.log(`metadata →  ${pointer.metadataAddress?.toBase58()}${self ? " (the mint itself)" : ""}`);
  }
  if (metadata) {
    console.log(`name        ${metadata.name}`);
    console.log(`symbol      ${metadata.symbol}`);
    console.log(`uri         ${metadata.uri}`);
    for (const [key, value] of metadata.additionalMetadata) console.log(`  ${key}: ${value}`);
  }
  console.log(`explorer    ${explorerAddress(mint)}`);
}

async function main() {
  console.log(`RPC ${RPC_URL} · wallet ${payer.publicKey.toBase58()}\n`);
  if (command && !["show", "balance", "holders"].includes(command) && (await conn.getBalance(payer.publicKey)) === 0) {
    console.error(`Wallet has 0 SOL. Fund it at https://faucet.solana.com (address ${payer.publicKey.toBase58()}).`);
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "create": {
      const { mint, signature } = await createPetcoinMint(conn, payer, payer.publicKey, { uri: option("uri") });
      writeFileSync(MINTS_FILE, JSON.stringify({ ...savedMints(), [RPC_URL]: mint.toBase58() }, null, 2) + "\n");
      console.log(`created ${explorerTx(signature)}\n`);
      await show(mint);
      return;
    }
    case "show":
      await show(mintAddress());
      return;
    case "mint": {
      const to = option("to") ? new PublicKey(option("to")!) : payer.publicKey;
      const amount = requireAmount();
      const { ata, signature } = await mintPetcoin(conn, payer, payer, mintAddress(), to, amount);
      console.log(`minted ${formatAmount(amount)} PET to ${to.toBase58()} (token account ${ata.toBase58()})`);
      console.log(`tx ${explorerTx(signature)}`);
      return;
    }
    case "transfer": {
      const to = new PublicKey(option("to") ?? "");
      const amount = requireAmount();
      const mint = mintAddress();
      const { signature, fee } = await transferPetcoin(conn, payer, payer, mint, to, amount);
      console.log(`sent ${formatAmount(amount)} PET → ${to.toBase58()}`);
      console.log(`fee  ${formatAmount(fee)} PET withheld on the recipient's account, recipient received ${formatAmount(amount - fee)}`);
      console.log(`tx   ${explorerTx(signature)}`);
      console.log(`balance now ${formatAmount(await balanceOf(conn, mint, payer.publicKey))} PET`);
      return;
    }
    case "balance": {
      const owner = option("wallet") ? new PublicKey(option("wallet")!) : payer.publicKey;
      console.log(`${owner.toBase58()}: ${formatAmount(await balanceOf(conn, mintAddress(), owner))} PET`);
      return;
    }
    case "holders": {
      const holders = await petcoinHolders(conn, mintAddress());
      holders.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
      for (const h of holders) {
        console.log(`${h.owner.toBase58().padEnd(44)} ${formatAmount(h.amount).padStart(14)} PET   withheld ${formatAmount(h.withheld)}`);
      }
      if (!holders.length) console.log("No token accounts yet.");
      return;
    }
    case "meta": {
      const mint = mintAddress();
      const remove = option("remove");
      const field = option("field");
      if (remove) {
        console.log(`tx ${explorerTx(await removePetcoinField(conn, payer, mint, remove))}\n`);
      } else if (field) {
        console.log(`tx ${explorerTx(await updatePetcoinField(conn, payer, mint, field, option("value") ?? ""))}\n`);
      }
      await show(mint);
      return;
    }
    case "collect-fees": {
      const { signature, collected, sources } = await collectPetcoinFees(conn, payer, mintAddress());
      console.log(`collected ${formatAmount(collected)} PET from ${sources} account(s) + the mint`);
      console.log(`tx ${explorerTx(signature)}`);
      return;
    }
    case "burn": {
      const amount = requireAmount();
      const mint = mintAddress();
      const signature = await burnPetcoin(conn, payer, mint, amount);
      console.log(`burned ${formatAmount(amount)} PET · tx ${explorerTx(signature)}`);
      console.log(`balance now ${formatAmount(await balanceOf(conn, mint, payer.publicKey))} PET`);
      return;
    }
    default:
      console.log(
        `Usage: npm run petcoin -- create|show|mint|transfer|balance|holders|meta|collect-fees|burn  (see header of clients/petcoin.ts)\n` +
          `Token: ${PETCOIN.name} (${PETCOIN.symbol}), ${PETCOIN.decimals} decimals, ${PETCOIN.feeBasisPoints / 100}% transfer fee`,
      );
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (err?.logs) console.error(err.logs.join("\n"));
  process.exit(1);
});
