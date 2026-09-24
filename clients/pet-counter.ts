// Devnet client for programs/pet_counter (course week 5).
//
// Unlike clients/pet-passport.ts, nothing here is encoded by hand: the IDL
// that `anchor build` writes to target/idl/ tells @anchor-lang/core how to
// serialize arguments, which accounts each instruction needs, and how to
// decode CareCounter accounts and CareCounterChanged events.
//
//   npm run counter -- init  --pet <petId>     (petId = Pet.id from the backend, <= 32 bytes)
//   npm run counter -- inc   --pet <petId>
//   npm run counter -- dec   --pet <petId>
//   npm run counter -- reset --pet <petId>
//   npm run counter -- show  --pet <petId>
//   npm run counter -- list
//   npm run counter -- close --pet <petId>

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AnchorError, AnchorProvider, EventParser, Program, Wallet } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { PetCounter } from "../target/types/pet_counter";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, RPC_URL } from "./common";

const IDL_PATH = join(__dirname, "..", "target", "idl", "pet_counter.json");
if (!existsSync(IDL_PATH)) {
  console.error(`IDL not found at ${IDL_PATH}. Run \`anchor build\` first (see docs/course/week-05-anchor-counter.md).`);
  process.exit(1);
}

const { command, option } = parseArgs();
const conn = connection();
const wallet = new Wallet(loadKeypair());
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
// The program id comes from the IDL's "address" field.
const program = new Program<PetCounter>(JSON.parse(readFileSync(IDL_PATH, "utf8")), provider);

function counterAddress(petId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("care"), wallet.publicKey.toBuffer(), Buffer.from(petId)],
    program.programId
  )[0];
}

async function printEvents(signature: string) {
  const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const parser = new EventParser(program.programId, program.coder);
  for (const event of parser.parseLogs(tx?.meta?.logMessages ?? [])) {
    console.log(`event ${event.name}: count=${event.data.count.toString()}`);
  }
}

async function show(counter: PublicKey) {
  const c = await program.account.careCounter.fetch(counter);
  console.log(`counter  ${counter.toBase58()}`);
  console.log(`pet      ${c.petId}`);
  console.log(`count    ${c.count.toString()}`);
  console.log(`updated  ${new Date(c.lastUpdatedAt.toNumber() * 1000).toISOString()}`);
  console.log(`explorer ${explorerAddress(counter)}`);
}

async function main() {
  console.log(`RPC ${RPC_URL} · program ${program.programId.toBase58()} · wallet ${wallet.publicKey.toBase58()}\n`);

  if (command === "list") {
    // CareCounter layout: 8-byte discriminator, then `authority` — filter on it.
    const mine = await program.account.careCounter.all([{ memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } }]);
    for (const { publicKey, account } of mine) console.log(`${publicKey.toBase58()}  pet ${account.petId}  count ${account.count}`);
    if (!mine.length) console.log("No counters yet: npm run counter -- init --pet <petId>");
    return;
  }

  const petId = option("pet");
  if (!petId) throw new Error("--pet <petId> is required");
  const counter = counterAddress(petId);
  const accounts = { authority: wallet.publicKey, counter };

  let signature: string | undefined;
  switch (command) {
    case "init":
      signature = await program.methods.initialize(petId).accountsPartial(accounts).rpc();
      break;
    case "inc":
      signature = await program.methods.increment().accountsPartial(accounts).rpc();
      break;
    case "dec":
      signature = await program.methods.decrement().accountsPartial(accounts).rpc();
      break;
    case "reset":
      signature = await program.methods.reset().accountsPartial(accounts).rpc();
      break;
    case "close":
      signature = await program.methods.closeCounter().accountsPartial(accounts).rpc();
      console.log(`closed, rent refunded: ${explorerTx(signature)}`);
      return;
    case "show":
      break;
    default:
      console.log("Usage: npm run counter -- init|inc|dec|reset|show|close --pet <petId>   |   npm run counter -- list");
      process.exitCode = 1;
      return;
  }

  if (signature) {
    console.log(`tx ${explorerTx(signature)}`);
    await printEvents(signature);
    console.log();
  }
  await show(counter);
}

main().catch((err) => {
  if (err instanceof AnchorError) {
    console.error(`pet_counter error ${err.error.errorCode.code}: ${err.error.errorMessage}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
