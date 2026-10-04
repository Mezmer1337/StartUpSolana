// PETCOIN on Token-2022 (course week 7). No program of ours is involved — these tests drive the
// Token-2022 program itself through clients/petcoin-core.ts, the same code the CLI uses.
//
//   npm run test:petcoin   (ANCHOR_PROVIDER_URL + ANCHOR_WALLET, same as the Anchor suites)

import { expect } from "chai";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAccount,
  getExtensionTypes,
  getMetadataPointerState,
  getMint,
  getTokenMetadata,
  getTransferFeeAmount,
  getTransferFeeConfig,
} from "@solana/spl-token";
import { createUpdateFieldInstruction } from "@solana/spl-token-metadata";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { connection, loadKeypair } from "../clients/common";
import {
  PETCOIN,
  balanceOf,
  burnPetcoin,
  collectPetcoinFees,
  createPetcoinMint,
  formatAmount,
  mintPetcoin,
  parseAmount,
  petcoinAta,
  removePetcoinField,
  send,
  transferPetcoin,
  updatePetcoinField,
} from "../clients/petcoin-core";

const PET = (value: string) => parseAmount(value);

/** Expects the promise to fail with a Token-2022 error whose logs mention `text`. */
async function expectFailure(promise: Promise<unknown>, text: RegExp) {
  try {
    await promise;
  } catch (err: any) {
    const details = [String(err?.message ?? err), ...(err?.logs ?? [])].join("\n");
    expect(details).to.match(text);
    return;
  }
  expect.fail(`expected failure matching ${text}`);
}

describe("petcoin (Token-2022)", () => {
  const conn = connection();
  const authority = loadKeypair();
  const player = Keypair.generate();
  const other = Keypair.generate();
  let mint: PublicKey;

  before(async () => {
    if ((await conn.getBalance(authority.publicKey)) < LAMPORTS_PER_SOL / 10) {
      throw new Error(`Wallet ${authority.publicKey.toBase58()} needs at least 0.1 SOL — fund it at https://faucet.solana.com`);
    }
    // Fund the second player by transfer, not airdrop: works on devnet too, where airdrops are rate-limited.
    await send(conn, authority, [
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: player.publicKey, lamports: LAMPORTS_PER_SOL / 20 }),
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: other.publicKey, lamports: LAMPORTS_PER_SOL / 20 }),
    ]);
    ({ mint } = await createPetcoinMint(conn, authority, authority.publicKey));
  });

  it("parses and formats amounts without floats", () => {
    expect(parseAmount("12.5")).to.equal(12_500_000n);
    expect(parseAmount("0.000001")).to.equal(1n);
    expect(formatAmount(12_500_000n)).to.equal("12.5");
    expect(formatAmount(1n)).to.equal("0.000001");
    expect(() => parseAmount("0.0000001")).to.throw(/more than 6 decimals/);
    expect(() => parseAmount("-1")).to.throw(/Invalid amount/);
  });

  it("creates a Token-2022 mint with fee, metadata pointer and on-mint metadata", async () => {
    const info = await conn.getAccountInfo(mint);
    expect(info!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());

    const state = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(state.decimals).to.equal(6);
    expect(state.mintAuthority!.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(state.freezeAuthority).to.equal(null);
    expect(getExtensionTypes(state.tlvData)).to.have.members([
      ExtensionType.TransferFeeConfig,
      ExtensionType.MetadataPointer,
      ExtensionType.TokenMetadata,
    ]);

    // The pointer says "metadata is in the mint itself" — no extra account.
    expect(getMetadataPointerState(state)!.metadataAddress!.toBase58()).to.equal(mint.toBase58());

    const fee = getTransferFeeConfig(state)!;
    expect(fee.newerTransferFee.transferFeeBasisPoints).to.equal(100);
    expect(fee.newerTransferFee.maximumFee).to.equal(PETCOIN.maxFee);

    const metadata = (await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))!;
    expect(metadata.name).to.equal("PetCoin");
    expect(metadata.symbol).to.equal("PET");
    expect(metadata.uri).to.equal(PETCOIN.uri);
    expect(metadata.updateAuthority!.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(metadata.additionalMetadata).to.deep.equal(PETCOIN.additionalMetadata);
  });

  it("mints to an associated token account and increases supply", async () => {
    const { ata } = await mintPetcoin(conn, authority, authority, mint, authority.publicKey, PET("1000"));
    expect(ata.toBase58()).to.equal(petcoinAta(mint, authority.publicKey).toBase58());
    expect(await balanceOf(conn, mint, authority.publicKey)).to.equal(PET("1000"));
    expect((await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID)).supply).to.equal(PET("1000"));
  });

  it("rejects minting by anyone but the mint authority", async () => {
    const ata = petcoinAta(mint, player.publicKey);
    await expectFailure(
      send(conn, player, [
        createAssociatedTokenAccountIdempotentInstruction(player.publicKey, ata, player.publicKey, mint, TOKEN_2022_PROGRAM_ID),
        createMintToCheckedInstruction(mint, ata, player.publicKey, PET("1"), 6, [], TOKEN_2022_PROGRAM_ID),
      ]),
      /custom program error: 0x4\b/, // TokenError::OwnerMismatch
    );
  });

  it("transfer withholds 1% on the recipient's account", async () => {
    const { fee } = await transferPetcoin(conn, authority, authority, mint, player.publicKey, PET("100"));
    expect(fee).to.equal(PET("1"));
    const account = await getAccount(conn, petcoinAta(mint, player.publicKey), "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(account.amount).to.equal(PET("99"));
    expect(getTransferFeeAmount(account)!.withheldAmount).to.equal(PET("1"));
    expect(await balanceOf(conn, mint, authority.publicKey)).to.equal(PET("900"));
  });

  it("caps the fee at 5 PET per transfer", async () => {
    const { fee } = await transferPetcoin(conn, authority, authority, mint, other.publicKey, PET("800"));
    expect(fee).to.equal(PET("5")); // 1% would be 8
    expect(await balanceOf(conn, mint, other.publicKey)).to.equal(PET("795"));
  });

  it("rejects a transfer whose stated fee is wrong", async () => {
    await expectFailure(transferPetcoin(conn, authority, authority, mint, player.publicKey, PET("10"), 0n), /custom program error: 0x20\b/); // TokenError::FeeMismatch (32)
  });

  it("players transfer between themselves; fee is withheld again", async () => {
    const { fee } = await transferPetcoin(conn, player, player, mint, other.publicKey, PET("50"));
    expect(fee).to.equal(PET("0.5"));
    expect(await balanceOf(conn, mint, player.publicKey)).to.equal(PET("49"));
    expect(await balanceOf(conn, mint, other.publicKey)).to.equal(PET("844.5"));
  });

  it("rejects spending more than the balance", async () => {
    await expectFailure(transferPetcoin(conn, player, player, mint, other.publicKey, PET("1000")), /custom program error: 0x1\b/); // TokenError::InsufficientFunds
  });

  it("updates and removes metadata fields (update authority only)", async () => {
    await updatePetcoinField(conn, authority, mint, "description", "In-game currency of PetNFT");
    await updatePetcoinField(conn, authority, mint, "uri", "https://example.com/petcoin.json");
    let metadata = (await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))!;
    expect(metadata.uri).to.equal("https://example.com/petcoin.json");
    expect(metadata.additionalMetadata).to.deep.include(["description", "In-game currency of PetNFT"]);

    await removePetcoinField(conn, authority, mint, "description");
    metadata = (await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID))!;
    expect(metadata.additionalMetadata.map(([key]) => key)).to.not.include("description");

    await expectFailure(
      send(conn, player, [
        createUpdateFieldInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint,
          updateAuthority: player.publicKey,
          field: "name",
          value: "ScamCoin",
        }),
      ]),
      /custom program error: 0x35c2b5c0\b/, // TokenMetadataError::IncorrectUpdateAuthority (901952960)
    );
  });

  it("collects all withheld fees into the authority's account", async () => {
    const before = await balanceOf(conn, mint, authority.publicKey);
    const { collected, sources } = await collectPetcoinFees(conn, authority, mint);
    expect(collected).to.equal(PET("6.5")); // 1 + 5 + 0.5
    expect(sources).to.equal(2);
    expect(await balanceOf(conn, mint, authority.publicKey)).to.equal(before + PET("6.5"));
    const state = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(getTransferFeeConfig(state)!.withheldAmount).to.equal(0n);
  });

  it("burn reduces balance and supply", async () => {
    await burnPetcoin(conn, other, mint, PET("44.5"));
    expect(await balanceOf(conn, mint, other.publicKey)).to.equal(PET("800"));
    expect((await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID)).supply).to.equal(PET("955.5"));
  });
});
