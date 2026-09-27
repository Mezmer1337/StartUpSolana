import { readFileSync } from "fs";
import { resolve } from "path";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ATA_PROGRAM_ID,
  base58Decode,
  buildTxReport,
  SYSTEM_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/services/txDetectiveService";

// Real devnet transactions, saved with `scripts/tx-detective.ts <sig> --save`.
function fixture(name: string): ParsedTransactionWithMeta {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));
}

const TREASURY = "ADB7iuwTCEakyoQ4KPXgWj44nMfCFTeqLkj2TTNJwc7b";

describe("txDetective — PetNFT mint payment (System transfer to treasury)", () => {
  const tx = fixture("tx-mint-payment.json");
  const report = buildTxReport(tx.transaction.signatures[0], tx, { treasuryWallet: TREASURY });

  it("identifies accounts, their roles and SOL movements", () => {
    const payer = report.accounts[0];
    expect(payer).toMatchObject({ signer: true, writable: true, feePayer: true });
    const treasury = report.accounts.find((a) => a.address === TREASURY)!;
    expect(treasury).toMatchObject({ signer: false, writable: true, label: "PetNFT treasury", lamportsDelta: 100_000_000 });
    // The payer loses the transfer AND the fee.
    expect(payer.lamportsDelta).toBe(-(100_000_000 + report.feeLamports));
    // Programs are read-only accounts too.
    expect(report.accounts.find((a) => a.address === SYSTEM_PROGRAM_ID)).toMatchObject({ writable: false, signer: false });
  });

  it("decodes every instruction and the program that runs it", () => {
    expect(report.instructions.map((i) => `${i.programName}:${i.name}`)).toEqual([
      "Compute Budget:SetComputeUnitPrice",
      "Compute Budget:SetComputeUnitLimit",
      "System Program:transfer",
    ]);
    expect(report.instructions.every((i) => i.depth === 0)).toBe(true);
    expect(report.instructions[2].details).toMatchObject({ destination: TREASURY, lamports: 100_000_000 });
  });

  it("explains the fee and flags the payment as a PetNFT mint payment", () => {
    expect(report.summary.join("\n")).toContain("= 80000 lamports");
    expect(report.feeLamports).toBe(80_000);
    expect(report.summary.join("\n")).toContain("PetNFT mint payment");
  });
});

describe("txDetective — Metaplex NFT mint (createNft = CreateV1 + MintV1)", () => {
  const tx = fixture("tx-nft-mint.json");
  const report = buildTxReport(tx.transaction.signatures[0], tx);

  it("recognises the Token Metadata instructions by their first data byte", () => {
    const top = report.instructions.filter((i) => i.depth === 0);
    expect(top.map((i) => i.name)).toEqual(["SetComputeUnitPrice", "SetComputeUnitLimit", "CreateV1", "MintV1", "memo"]);
    expect(top[2].programId).toBe(TOKEN_METADATA_PROGRAM_ID);
  });

  it("builds a CPI tree with nested paths from stackHeight", () => {
    const paths = report.instructions.map((i) => `${i.path} ${i.name}`);
    expect(paths).toContain("3.2 createAccount");
    expect(paths).toContain("3.3 initializeMint2");
    expect(paths).toContain("4.1 create");
    // ATA program -> SPL Token: a CPI made by a CPI.
    expect(paths).toContain("4.1.4 initializeAccount3");
    expect(paths).toContain("4.2 mintTo");
    const ataInit = report.instructions.find((i) => i.path === "4.1.4")!;
    expect(ataInit).toMatchObject({ depth: 2, programId: TOKEN_PROGRAM_ID });
  });

  it("verifies metadata / master edition / token account against re-derived PDAs", () => {
    const pdaLines = report.summary.filter((l) => l.trim().startsWith("OK") || l.includes("MISMATCH"));
    expect(pdaLines).toHaveLength(3);
    expect(pdaLines.every((l) => l.trim().startsWith("OK"))).toBe(true);
  });

  it("reports the NFT arriving in the owner's token account", () => {
    expect(report.tokenBalanceChanges).toHaveLength(1);
    expect(report.tokenBalanceChanges[0]).toMatchObject({ before: "0", after: "1", delta: "+1" });
    const programs = Object.fromEntries(report.programs.map((p) => [p.programId, p.invocations]));
    expect(programs[ATA_PROGRAM_ID]).toBe(1);
    expect(programs[TOKEN_METADATA_PROGRAM_ID]).toBe(2);
  });
});

describe("txDetective — our own programs on devnet (weeks 4-5)", () => {
  const PASSPORT = "2k6jZXKSG5tHuksuMiiuvPYxK4av3WyTQMMidzmmNB2U";
  const COUNTER = "F2msfiA9Ndo2s8gMRwykGSaEFbXVLtFHDhGMFRzPEZ8P";

  it("decodes the native pet_passport CreatePassport instruction (no IDL)", () => {
    const tx = fixture("tx-passport-create.json");
    const report = buildTxReport(tx.transaction.signatures[0], tx, { passportProgramId: PASSPORT });

    expect(report.instructions.map((i) => i.name)).toEqual(["createAccount", "CreatePassport"]);
    const create = report.instructions[1];
    expect(create.details).toEqual({
      name: "Blaze",
      dnaHash: "63126e9e4dd0904cb9e05739d990087a000e2d4d6039ab64925e442a203309ba",
    });
    expect(create.accounts.map((a) => a.role)).toEqual(["owner", "passport"]);
    // The account System Program created in instruction 1 is the one our program filled in instruction 2.
    expect(report.instructions[0].details.newAccount).toBe(create.accounts[1].address);
    expect(report.instructions[0].details.owner).toBe(PASSPORT);
  });

  it("recognises the Anchor pet_counter instruction by its discriminator", () => {
    const tx = fixture("tx-counter-increment.json");
    const report = buildTxReport(tx.transaction.signatures[0], tx);

    expect(report.instructions).toHaveLength(1);
    expect(report.instructions[0]).toMatchObject({ programId: COUNTER, name: "increment" });
    expect(report.logs).toContain("Program log: Instruction: Increment");
  });
});

describe("base58Decode", () => {
  it("decodes addresses to 32 bytes, keeping leading zero bytes", () => {
    expect(base58Decode(SYSTEM_PROGRAM_ID)).toEqual(new Uint8Array(32));
    expect(base58Decode(TOKEN_PROGRAM_ID)).toHaveLength(32);
  });

  it("rejects characters outside the base58 alphabet", () => {
    expect(() => base58Decode("0OIl")).toThrow();
  });
});
