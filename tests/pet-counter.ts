import * as anchor from "@anchor-lang/core";
import { AnchorError, EventParser, Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";
import type { PetCounter } from "../target/types/pet_counter";

describe("pet_counter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.petCounter as Program<PetCounter>;

  const authority = provider.wallet.publicKey;
  // Unique per run, so the suite also works against a persistent cluster (devnet).
  const petId = `pet-${Date.now()}`;
  const counterFor = (owner: PublicKey, id: string) =>
    PublicKey.findProgramAddressSync([Buffer.from("care"), owner.toBuffer(), Buffer.from(id)], program.programId)[0];
  const counter = counterFor(authority, petId);
  const accounts = { authority, counter };

  async function expectAnchorError(promise: Promise<unknown>, codes: string[]) {
    try {
      await promise;
    } catch (err) {
      if (err instanceof AnchorError) {
        expect(codes).to.include(err.error.errorCode.code);
        return;
      }
      throw err;
    }
    assert.fail(`expected one of ${codes.join(", ")}`);
  }

  it("initializes a care counter PDA for a pet", async () => {
    await program.methods.initialize(petId).accountsPartial(accounts).rpc();

    const c = await program.account.careCounter.fetch(counter);
    expect(c.authority.toBase58()).to.equal(authority.toBase58());
    expect(c.petId).to.equal(petId);
    expect(c.count.toNumber()).to.equal(0);
  });

  it("increments and decrements, emitting CareCounterChanged", async () => {
    await program.methods.increment().accountsPartial(accounts).rpc();
    await program.methods.increment().accountsPartial(accounts).rpc();
    const signature = await program.methods.decrement().accountsPartial(accounts).rpc({ commitment: "confirmed" });

    expect((await program.account.careCounter.fetch(counter)).count.toNumber()).to.equal(1);

    const tx = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const events = [...new EventParser(program.programId, program.coder).parseLogs(tx!.meta!.logMessages!)];
    expect(events.map((e) => e.name)).to.deep.equal(["careCounterChanged"]);
    expect(events[0].data.count.toNumber()).to.equal(1);
  });

  it("never goes below zero", async () => {
    await program.methods.reset().accountsPartial(accounts).rpc();
    await expectAnchorError(program.methods.decrement().accountsPartial(accounts).rpc(), ["Underflow"]);
  });

  it("rejects an empty pet id", async () => {
    await expectAnchorError(
      program.methods.initialize("").accountsPartial({ authority, counter: counterFor(authority, "") }).rpc(),
      ["InvalidPetId"]
    );
  });

  it("lets only the owner change the counter", async () => {
    const stranger = Keypair.generate();
    // Fund the stranger from the provider wallet (works on localnet and devnet alike).
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: authority, toPubkey: stranger.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL })
      )
    );

    await expectAnchorError(
      program.methods.increment().accountsPartial({ authority: stranger.publicKey, counter }).signers([stranger]).rpc(),
      // The PDA re-derived with the stranger's key doesn't match, so `seeds` fails before `has_one`.
      ["ConstraintSeeds", "Unauthorized"]
    );
  });

  it("closes the counter and refunds the rent", async () => {
    await program.methods.closeCounter().accountsPartial(accounts).rpc();
    expect(await provider.connection.getAccountInfo(counter)).to.equal(null);
  });
});
