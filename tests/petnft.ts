import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import type { Petnft } from "../target/types/petnft";
import { testProvider } from "./utils";

describe("petnft", () => {
  const provider = testProvider();
  anchor.setProvider(provider);
  const program = anchor.workspace.petnft as Program<Petnft>;

  it("initializes a pet record PDA for a mint and checkpoints its level", async () => {
    // Any address works as the "mint" here: the program only uses it as a PDA seed.
    const mint = Keypair.generate().publicKey;
    const [petRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("pet-record"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .initializePetRecord("Blaze", { dragon: {} }, { mythic: {} })
      .accountsPartial({ owner: provider.wallet.publicKey, mint, petRecord })
      .rpc();

    let record = await program.account.petRecord.fetch(petRecord);
    expect(record.name).to.equal("Blaze");
    expect(record.level).to.equal(1);
    expect(record.rarity).to.deep.equal({ mythic: {} });

    await program.methods.updatePetLevel(5).accountsPartial({ owner: provider.wallet.publicKey, petRecord }).rpc();
    record = await program.account.petRecord.fetch(petRecord);
    expect(record.level).to.equal(5);
  });
});
