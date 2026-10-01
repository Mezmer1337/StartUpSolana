// Devnet client for programs/player_profile (course week 6).
//
//   npm run profile -- create --username blaze --bio "Raising dragons"
//   npm run profile -- show                         (your profile)
//   npm run profile -- show --wallet <address>      (anyone's profile: PDA from the wallet)
//   npm run profile -- show --username blaze        (username PDA -> wallet -> profile)
//   npm run profile -- bio --bio "New bio"
//   npm run profile -- rename --username ember
//   npm run profile -- pets                         (your petnft PetRecords)
//   npm run profile -- feature --pet-record <address>
//   npm run profile -- unfeature
//   npm run profile -- close

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AnchorError, AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { PlayerProfile } from "../target/types/player_profile";
import type { Petnft } from "../target/types/petnft";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, RPC_URL } from "./common";

function loadIdl(name: string) {
  const path = join(__dirname, "..", "target", "idl", `${name}.json`);
  if (!existsSync(path)) {
    console.error(`IDL not found at ${path}. Run \`anchor build\` first (see docs/course/week-06-pda-profile.md).`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const { command, option } = parseArgs();
const conn = connection();
const wallet = new Wallet(loadKeypair());
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
const program = new Program<PlayerProfile>(loadIdl("player_profile"), provider);
const petnft = new Program<Petnft>(loadIdl("petnft"), provider);

const profileOf = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("profile"), owner.toBuffer()], program.programId)[0];
const usernameRecordOf = (username: string) =>
  PublicKey.findProgramAddressSync([Buffer.from("username"), Buffer.from(username)], program.programId)[0];

async function show(owner: PublicKey) {
  const address = profileOf(owner);
  const p = await program.account.playerProfile.fetchNullable(address);
  if (!p) {
    console.log(`${owner.toBase58()} has no profile (PDA ${address.toBase58()} is empty)`);
    return;
  }
  console.log(`profile   ${address.toBase58()}   = PDA["profile", ${owner.toBase58()}]`);
  console.log(`username  @${p.username}   (PDA["username", "${p.username}"] = ${usernameRecordOf(p.username).toBase58()})`);
  console.log(`bio       ${p.bio || "—"}`);
  if (p.featuredPet) {
    const pet = await petnft.account.petRecord.fetch(p.featuredPet);
    console.log(`featured  ${pet.name} (${Object.keys(pet.petType)[0]}, ${Object.keys(pet.rarity)[0]}, lvl ${pet.level}) — ${p.featuredPet.toBase58()}`);
  } else {
    console.log("featured  —");
  }
  console.log(`created   ${new Date(p.createdAt.toNumber() * 1000).toISOString()}`);
  console.log(`explorer  ${explorerAddress(address)}`);
}

async function main() {
  console.log(`RPC ${RPC_URL} · program ${program.programId.toBase58()} · wallet ${wallet.publicKey.toBase58()}\n`);
  const authority = wallet.publicKey;
  let signature: string | undefined;

  switch (command) {
    case "create": {
      const username = option("username");
      if (!username) throw new Error("--username is required");
      signature = await program.methods.createProfile(username, option("bio") ?? "").accounts({ authority }).rpc();
      break;
    }
    case "bio":
      signature = await program.methods.updateBio(option("bio") ?? "").accounts({ authority }).rpc();
      break;
    case "rename": {
      const next = option("username");
      if (!next) throw new Error("--username is required");
      const current = await program.account.playerProfile.fetch(profileOf(authority));
      signature = await program.methods
        .changeUsername(next)
        .accountsPartial({
          authority,
          oldUsernameRecord: usernameRecordOf(current.username),
          newUsernameRecord: usernameRecordOf(next),
        })
        .rpc();
      break;
    }
    case "pets": {
      // PetRecord layout: 8-byte discriminator, mint (32), owner (32) -> owner at offset 40.
      const pets = await petnft.account.petRecord.all([{ memcmp: { offset: 40, bytes: authority.toBase58() } }]);
      for (const { publicKey, account } of pets) {
        console.log(`${publicKey.toBase58()}  ${account.name}  lvl ${account.level}`);
      }
      if (!pets.length) console.log("No petnft PetRecords for this wallet.");
      return;
    }
    case "feature": {
      const petRecord = new PublicKey(option("pet-record") ?? "");
      signature = await program.methods.setFeaturedPet().accountsPartial({ authority, petRecord }).rpc();
      break;
    }
    case "unfeature":
      signature = await program.methods.clearFeaturedPet().accounts({ authority }).rpc();
      break;
    case "close": {
      const current = await program.account.playerProfile.fetch(profileOf(authority));
      signature = await program.methods
        .closeProfile()
        .accountsPartial({ authority, usernameRecord: usernameRecordOf(current.username) })
        .rpc();
      console.log(`closed, rent refunded: ${explorerTx(signature)}`);
      return;
    }
    case "show": {
      const byUsername = option("username");
      if (byUsername) {
        // username -> UsernameRecord PDA -> owner wallet -> profile PDA
        const record = await program.account.usernameRecord.fetchNullable(usernameRecordOf(byUsername));
        if (!record) {
          console.log(`@${byUsername} is free`);
          return;
        }
        await show(record.authority);
      } else {
        await show(option("wallet") ? new PublicKey(option("wallet")!) : authority);
      }
      return;
    }
    default:
      console.log("Usage: npm run profile -- create|show|bio|rename|pets|feature|unfeature|close  (see header of clients/player-profile.ts)");
      process.exitCode = 1;
      return;
  }

  console.log(`tx ${explorerTx(signature)}\n`);
  await show(authority);
}

main().catch((err) => {
  if (err instanceof AnchorError) {
    console.error(`player_profile error ${err.error.errorCode.code}: ${err.error.errorMessage}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
