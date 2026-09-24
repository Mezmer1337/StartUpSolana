// Devnet client for native/pet_passport (course week 4).
//
// There is no IDL for a native program, so this client does by hand what
// Anchor's client does for you: builds the instruction bytes, lists the
// accounts with their signer/writable flags, and decodes account data.
//
//   npm run passport -- create --name Blaze [--dna <Pet.dnaHash from the backend>]
//   npm run passport -- feed --passport <address>
//   npm run passport -- show --passport <address>
//
// Program id: --program <id>, else PET_PASSPORT_PROGRAM_ID, else the keypair
// that `cargo build-sbf` generated in native/pet_passport/target/deploy/.

import { createHash } from "crypto";
import { join } from "path";
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, programIdFromKeypair, RPC_URL } from "./common";

/** Must equal PetPassport::LEN in native/pet_passport/src/state.rs. */
const PASSPORT_LEN = 1 + 32 + 32 + (4 + 32) + 8 + 8 + 8;
const MAX_NAME_LEN = 32;

/** PassportError in native/pet_passport/src/error.rs, by code. */
const PASSPORT_ERRORS = [
  "AlreadyInitialized",
  "NotInitialized",
  "EmptyName",
  "NameTooLong",
  "NotOwner",
  "FeedCooldown",
  "NotRentExempt",
  "AccountNotWritable",
  "MathOverflow",
];

// ---- Instruction data (Borsh enum: variant byte + fields) -----------------------

function encodeCreatePassport(name: string, dnaHash: Buffer): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const nameLen = Buffer.alloc(4);
  nameLen.writeUInt32LE(nameBytes.length);
  return Buffer.concat([Buffer.from([0]), nameLen, nameBytes, dnaHash]);
}

const encodeFeed = () => Buffer.from([1]);

// ---- Account data ------------------------------------------------------------------

interface PetPassport {
  isInitialized: boolean;
  owner: PublicKey;
  dnaHash: string;
  name: string;
  createdAt: Date;
  feedCount: bigint;
  lastFedAt: Date | null;
}

function decodePassport(data: Buffer): PetPassport {
  let offset = 0;
  const isInitialized = data[offset] === 1;
  offset += 1;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const dnaHash = data.subarray(offset, offset + 32).toString("hex");
  offset += 32;
  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data.subarray(offset, offset + nameLen).toString("utf8");
  offset += nameLen;
  const createdAt = data.readBigInt64LE(offset);
  offset += 8;
  const feedCount = data.readBigUInt64LE(offset);
  offset += 8;
  const lastFedAt = data.readBigInt64LE(offset);
  return {
    isInitialized,
    owner,
    dnaHash,
    name,
    createdAt: new Date(Number(createdAt) * 1000),
    feedCount,
    lastFedAt: lastFedAt === 0n ? null : new Date(Number(lastFedAt) * 1000),
  };
}

// ---- Commands ----------------------------------------------------------------------

const { command, option } = parseArgs();
const conn = connection();

function programId(): PublicKey {
  const fromArg = option("program") ?? process.env.PET_PASSPORT_PROGRAM_ID;
  if (fromArg) return new PublicKey(fromArg);
  const fromKeypair = programIdFromKeypair(
    join(__dirname, "..", "native", "pet_passport", "target", "deploy", "pet_passport-keypair.json")
  );
  if (fromKeypair) return fromKeypair;
  throw new Error("Program id unknown: pass --program <id> or set PET_PASSPORT_PROGRAM_ID (see docs/course/week-04-native-program.md)");
}

async function send(tx: Transaction, signers: Keypair[]): Promise<string> {
  try {
    return await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const logs = (await err.getLogs(conn).catch(() => null)) ?? [];
      const code = logs.join("\n").match(/custom program error: 0x([0-9a-f]+)/i);
      if (code) throw new Error(`pet_passport error: ${PASSPORT_ERRORS[parseInt(code[1], 16)] ?? `#${code[1]}`}\n${logs.join("\n")}`);
      throw new Error(`${err.message}\n${logs.join("\n")}`);
    }
    throw err;
  }
}

async function show(address: PublicKey) {
  const account = await conn.getAccountInfo(address);
  if (!account) throw new Error(`No account at ${address.toBase58()}`);
  if (!account.owner.equals(programId())) {
    throw new Error(`${address.toBase58()} is owned by ${account.owner.toBase58()}, not by pet_passport`);
  }
  const p = decodePassport(account.data);
  console.log(`passport   ${address.toBase58()}  (${account.data.length} bytes, ${account.lamports} lamports rent)`);
  console.log(`name       ${p.name}`);
  console.log(`owner      ${p.owner.toBase58()}`);
  console.log(`dnaHash    ${p.dnaHash}`);
  console.log(`created    ${p.createdAt.toISOString()}`);
  console.log(`feedings   ${p.feedCount}${p.lastFedAt ? ` (last ${p.lastFedAt.toISOString()})` : ""}`);
  console.log(`explorer   ${explorerAddress(address)}`);
}

async function main() {
  const payer = loadKeypair();
  console.log(`RPC ${RPC_URL} · wallet ${payer.publicKey.toBase58()}\n`);

  switch (command) {
    case "create": {
      const name = option("name");
      if (!name) throw new Error("--name is required");
      if (Buffer.byteLength(name) > MAX_NAME_LEN) throw new Error(`--name must be at most ${MAX_NAME_LEN} bytes`);

      let dna = option("dna");
      if (!dna) {
        dna = createHash("sha256").update(`demo:${name}:${Date.now()}`).digest("hex");
        console.log(`No --dna given, using a demo hash. Pass a real Pet.dnaHash to anchor a real pet.\n`);
      }
      if (!/^[0-9a-f]{64}$/i.test(dna)) throw new Error("--dna must be 64 hex characters (a sha256)");

      const pid = programId();
      const passport = Keypair.generate();
      const rent = await conn.getMinimumBalanceForRentExemption(PASSPORT_LEN);

      const tx = new Transaction().add(
        // 1) System Program creates the account and hands ownership to our program.
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: passport.publicKey,
          lamports: rent,
          space: PASSPORT_LEN,
          programId: pid,
        }),
        // 2) Our program fills it in. Same transaction, so both succeed or neither does.
        new TransactionInstruction({
          programId: pid,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: passport.publicKey, isSigner: true, isWritable: true },
          ],
          data: encodeCreatePassport(name, Buffer.from(dna, "hex")),
        })
      );
      const sig = await send(tx, [payer, passport]);
      console.log(`created: ${explorerTx(sig)}\n`);
      await show(passport.publicKey);
      console.log(`\nNext: npm run passport -- feed --passport ${passport.publicKey.toBase58()}`);
      break;
    }
    case "feed": {
      const address = new PublicKey(option("passport") ?? "");
      const tx = new Transaction().add(
        new TransactionInstruction({
          programId: programId(),
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: address, isSigner: false, isWritable: true },
          ],
          data: encodeFeed(),
        })
      );
      const sig = await send(tx, [payer]);
      console.log(`fed: ${explorerTx(sig)}\n`);
      await show(address);
      break;
    }
    case "show":
      await show(new PublicKey(option("passport") ?? ""));
      break;
    default:
      console.log("Usage: npm run passport -- create --name <name> [--dna <hex>] | feed --passport <address> | show --passport <address>");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
