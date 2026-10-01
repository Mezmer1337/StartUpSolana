import * as anchor from "@anchor-lang/core";
import { AnchorError, Program } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";
import type { PlayerProfile } from "../target/types/player_profile";
import type { Petnft } from "../target/types/petnft";
import { testProvider } from "./utils";

describe("player_profile", () => {
  const provider = testProvider();
  anchor.setProvider(provider);
  const program = anchor.workspace.playerProfile as Program<PlayerProfile>;
  const petnft = anchor.workspace.petnft as Program<Petnft>;

  const pda = (seeds: (Buffer | Uint8Array)[], programId = program.programId) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];
  const profileOf = (wallet: PublicKey) => pda([Buffer.from("profile"), wallet.toBuffer()]);
  const usernameRecord = (name: string) => pda([Buffer.from("username"), Buffer.from(name)]);

  // Unique per run so the suite also works against a persistent cluster (devnet).
  const suffix = Date.now().toString(36).slice(-6);
  const username = `blaze_${suffix}`;
  const renamed = `ember_${suffix}`;

  // A second wallet: one profile per wallet, so other-user cases need another key.
  const stranger = Keypair.generate();
  const strangerProvider = testProvider(new anchor.Wallet(stranger));
  const asStranger = new Program<PlayerProfile>(program.idl, strangerProvider);
  const petnftAsStranger = new Program<Petnft>(petnft.idl, strangerProvider);

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

  async function createPetRecord(owner: Program<Petnft>, name: string) {
    const mint = Keypair.generate().publicKey;
    const petRecord = pda([Buffer.from("pet-record"), mint.toBuffer()], petnft.programId);
    await owner.methods
      .initializePetRecord(name, { fox: {} }, { rare: {} })
      .accountsPartial({ owner: owner.provider.publicKey!, mint, petRecord })
      .rpc();
    return petRecord;
  }

  before(async () => {
    // On a persistent cluster an interrupted run can leave our profile behind;
    // a wallet can only have one, so clean it up first.
    const leftover = await program.account.playerProfile.fetchNullable(profileOf(provider.publicKey));
    if (leftover) {
      await program.methods
        .closeProfile()
        .accountsPartial({ authority: provider.publicKey, usernameRecord: usernameRecord(leftover.username) })
        .rpc();
    }

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: provider.publicKey, toPubkey: stranger.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })
      )
    );
  });

  it("creates a profile PDA derived from the wallet, plus a username PDA", async () => {
    await program.methods.createProfile(username, "Raising dragons on devnet").accounts({ authority: provider.publicKey }).rpc();

    // Nothing to look up in a database: both addresses are derived.
    const profile = await program.account.playerProfile.fetch(profileOf(provider.publicKey));
    expect(profile.username).to.equal(username);
    expect(profile.bio).to.equal("Raising dragons on devnet");
    expect(profile.featuredPet).to.equal(null);
    expect(profile.authority.toBase58()).to.equal(provider.publicKey.toBase58());

    // Reverse lookup: username -> wallet -> profile.
    const record = await program.account.usernameRecord.fetch(usernameRecord(username));
    expect(record.authority.toBase58()).to.equal(provider.publicKey.toBase58());
  });

  it("allows only one profile per wallet", async () => {
    await expectError(
      program.methods.createProfile(`other_${suffix}`, "").accounts({ authority: provider.publicKey }).rpc(),
      "already in use"
    );
  });

  it("makes usernames unique across wallets", async () => {
    await expectError(
      asStranger.methods.createProfile(username, "copycat").accounts({ authority: stranger.publicKey }).rpc(),
      "already in use"
    );
  });

  it("rejects usernames that are not lowercase [a-z0-9_]{3,20}", async () => {
    for (const bad of ["Blaze", "ab", "has space", "x".repeat(21)]) {
      await expectError(
        asStranger.methods.createProfile(bad, "").accounts({ authority: stranger.publicKey }).rpc(),
        "InvalidUsername"
      );
    }
  });

  it("updates the bio, enforcing its maximum length", async () => {
    await program.methods.updateBio("Now with more foxes").accounts({ authority: provider.publicKey }).rpc();
    expect((await program.account.playerProfile.fetch(profileOf(provider.publicKey))).bio).to.equal("Now with more foxes");

    await expectError(
      program.methods.updateBio("x".repeat(161)).accounts({ authority: provider.publicKey }).rpc(),
      "BioTooLong"
    );
  });

  it("changes username: closes the old username PDA and claims the new one", async () => {
    await program.methods
      .changeUsername(renamed)
      .accountsPartial({
        authority: provider.publicKey,
        oldUsernameRecord: usernameRecord(username),
        newUsernameRecord: usernameRecord(renamed),
      })
      .rpc();

    expect((await program.account.playerProfile.fetch(profileOf(provider.publicKey))).username).to.equal(renamed);
    expect(await provider.connection.getAccountInfo(usernameRecord(username))).to.equal(null);
    expect((await program.account.usernameRecord.fetch(usernameRecord(renamed))).authority.toBase58()).to.equal(
      provider.publicKey.toBase58()
    );
  });

  it("features one of the owner's pets — a PetRecord PDA of the petnft program", async () => {
    const petRecord = await createPetRecord(petnft, "Ember");

    await program.methods.setFeaturedPet().accountsPartial({ authority: provider.publicKey, petRecord }).rpc();
    const profile = await program.account.playerProfile.fetch(profileOf(provider.publicKey));
    expect(profile.featuredPet!.toBase58()).to.equal(petRecord.toBase58());

    await program.methods.clearFeaturedPet().accounts({ authority: provider.publicKey }).rpc();
    expect((await program.account.playerProfile.fetch(profileOf(provider.publicKey))).featuredPet).to.equal(null);
  });

  it("refuses someone else's pet", async () => {
    const strangersPet = await createPetRecord(petnftAsStranger, "NotYours");
    await expectError(
      program.methods.setFeaturedPet().accountsPartial({ authority: provider.publicKey, petRecord: strangersPet }).rpc(),
      "NotPetOwner"
    );
  });

  it("refuses an account that is not a petnft PetRecord", async () => {
    // Our own UsernameRecord: right shape for nothing — wrong owner program for a PetRecord.
    await expectError(
      program.methods
        .setFeaturedPet()
        .accountsPartial({ authority: provider.publicKey, petRecord: usernameRecord(renamed) })
        .rpc(),
      "AccountOwnedByWrongProgram"
    );
  });

  it("closes the profile and frees the username", async () => {
    await program.methods.closeProfile().accountsPartial({ authority: provider.publicKey, usernameRecord: usernameRecord(renamed) }).rpc();
    expect(await provider.connection.getAccountInfo(profileOf(provider.publicKey))).to.equal(null);
    expect(await provider.connection.getAccountInfo(usernameRecord(renamed))).to.equal(null);

    // The freed username can be claimed by someone else now.
    await asStranger.methods.createProfile(renamed, "").accounts({ authority: stranger.publicKey }).rpc();
    expect((await program.account.usernameRecord.fetch(usernameRecord(renamed))).authority.toBase58()).to.equal(
      stranger.publicKey.toBase58()
    );
    await asStranger.methods.closeProfile().accountsPartial({ authority: stranger.publicKey, usernameRecord: usernameRecord(renamed) }).rpc();
  });
});
