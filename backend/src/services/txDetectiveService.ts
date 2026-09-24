import { createHash } from "crypto";
import {
  Connection,
  LAMPORTS_PER_SOL,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  TokenBalance,
} from "@solana/web3.js";

/**
 * Transaction Detective (course week 2): takes a real transaction and
 * answers the three questions every Solana transaction boils down to —
 * which ACCOUNTS it touches (and how), which INSTRUCTIONS it runs, and
 * which PROGRAMS execute them, including the CPIs (inner instructions)
 * programs make to each other.
 *
 * buildTxReport() is a pure function over an RPC `jsonParsed` transaction,
 * so it is unit-tested against saved real devnet transactions
 * (tests/fixtures/tx-*.json) without touching the network.
 */

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export const KNOWN_ADDRESSES: Record<string, string> = {
  [SYSTEM_PROGRAM_ID]: "System Program",
  [TOKEN_PROGRAM_ID]: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  [ATA_PROGRAM_ID]: "Associated Token Account",
  [TOKEN_METADATA_PROGRAM_ID]: "Metaplex Token Metadata",
  [COMPUTE_BUDGET_PROGRAM_ID]: "Compute Budget",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo (v1)",
  BPFLoaderUpgradeab1e11111111111111111111111: "BPF Upgradeable Loader",
  auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg: "Metaplex Token Auth Rules",
  Sysvar1nstructions1111111111111111111111111: "Sysvar: Instructions",
  SysvarRent111111111111111111111111111111111: "Sysvar: Rent",
  SysvarC1ock11111111111111111111111111111111: "Sysvar: Clock",
};

// Metaplex Token Metadata instructions are a Borsh enum: the first data
// byte is the variant index. Only the variants PetNFT-style mints use.
const TOKEN_METADATA_INSTRUCTIONS: Record<number, { name: string; accounts?: string[] }> = {
  15: { name: "UpdateMetadataAccountV2" },
  17: {
    name: "CreateMasterEditionV3",
    accounts: ["edition", "mint", "updateAuthority", "mintAuthority", "payer", "metadata", "tokenProgram", "systemProgram"],
  },
  18: { name: "VerifyCollection" },
  25: { name: "SetAndVerifyCollection" },
  30: { name: "VerifySizedCollectionItem" },
  32: { name: "SetAndVerifySizedCollectionItem" },
  33: {
    name: "CreateMetadataAccountV3",
    accounts: ["metadata", "mint", "mintAuthority", "payer", "updateAuthority", "systemProgram"],
  },
  41: { name: "BurnV1" },
  42: {
    name: "CreateV1",
    accounts: [
      "metadata",
      "masterEdition",
      "mint",
      "authority",
      "payer",
      "updateAuthority",
      "systemProgram",
      "sysvarInstructions",
      "splTokenProgram",
    ],
  },
  43: {
    name: "MintV1",
    accounts: [
      "token",
      "tokenOwner",
      "metadata",
      "masterEdition",
      "tokenRecord",
      "mint",
      "authority",
      "delegateRecord",
      "payer",
      "systemProgram",
      "sysvarInstructions",
      "splTokenProgram",
      "splAtaProgram",
      "authorizationRulesProgram",
      "authorizationRules",
    ],
  },
  49: { name: "TransferV1" },
  50: { name: "UpdateV1" },
  52: { name: "VerifyV1" },
};

/**
 * Anchor instruction data starts with sha256("global:<snake_case_name>")[..8].
 * We can't know every program's instruction names, but we can recognise the
 * ones used in this repo (programs/petnft, programs/pet_counter).
 */
const ANCHOR_INSTRUCTION_NAMES = [
  "initialize_pet_record",
  "update_pet_level",
  "initialize",
  "increment",
  "decrement",
  "reset",
  "close_counter",
];
const ANCHOR_DISCRIMINATORS = new Map(
  ANCHOR_INSTRUCTION_NAMES.map((name) => [
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex"),
    name,
  ])
);

export interface TxAccountRow {
  index: number;
  address: string;
  label: string | null;
  signer: boolean;
  writable: boolean;
  feePayer: boolean;
  /** "lookupTable" = loaded from an Address Lookup Table (v0 transactions). */
  source: string;
  lamportsBefore: number;
  lamportsAfter: number;
  lamportsDelta: number;
}

export interface TxInstructionRow {
  /** "2" = 2nd top-level instruction, "2.1" = first CPI made while running it, ... */
  path: string;
  /** 0 = top-level, 1 = called via CPI from a top-level instruction, ... */
  depth: number;
  programId: string;
  programName: string;
  name: string;
  details: Record<string, unknown>;
  /** Accounts passed to this instruction, with a role name when we know it. */
  accounts: { address: string; role: string | null }[];
}

export interface TokenBalanceChange {
  account: string;
  owner: string | null;
  mint: string;
  before: string;
  after: string;
  delta: string;
}

export interface TxReport {
  signature: string;
  cluster: string;
  explorerUrl: string;
  slot: number;
  blockTime: string | null;
  success: boolean;
  error: unknown;
  version: string;
  feeLamports: number;
  computeUnitsConsumed: number | null;
  recentBlockhash: string;
  signatures: string[];
  accounts: TxAccountRow[];
  instructions: TxInstructionRow[];
  programs: { programId: string; name: string; invocations: number }[];
  tokenBalanceChanges: TokenBalanceChange[];
  summary: string[];
  logs: string[];
}

export interface TxReportOptions {
  cluster?: string;
  /** Extra address -> label pairs, e.g. PetNFT's treasury and deployed program ids. */
  labels?: Record<string, string>;
  /** When set, SOL transfers to this address are flagged as PetNFT mint payments. */
  treasuryWallet?: string;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes base58 (the encoding of addresses and of unparsed instruction data). */
export function base58Decode(input: string): Uint8Array {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`Invalid base58 character "${char}"`);
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  // Every leading "1" encodes one leading zero byte.
  for (let i = 0; i < input.length && input[i] === "1"; i++) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

export function explorerTxUrl(signature: string, cluster: string): string {
  const query = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${query}`;
}

function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return "parsed" in ix;
}

function decodeComputeBudget(data: Uint8Array): { name: string; details: Record<string, unknown> } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  switch (data[0]) {
    case 1:
      return { name: "RequestHeapFrame", details: { bytes: view.getUint32(1, true) } };
    case 2:
      return { name: "SetComputeUnitLimit", details: { units: view.getUint32(1, true) } };
    case 3:
      return { name: "SetComputeUnitPrice", details: { microLamports: view.getBigUint64(1, true).toString() } };
    case 4:
      return { name: "SetLoadedAccountsDataSizeLimit", details: { bytes: view.getUint32(1, true) } };
    default:
      return { name: "unknown", details: { discriminator: data[0] } };
  }
}

function describeInstruction(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
  labels: Record<string, string>
): Pick<TxInstructionRow, "programId" | "programName" | "name" | "details" | "accounts"> {
  const programId = String(ix.programId);
  const programName = labels[programId] ?? KNOWN_ADDRESSES[programId] ?? "Unknown program";

  if (isParsed(ix)) {
    // The RPC node decoded it for us (System, SPL Token, ATA, Memo, ...).
    if (typeof ix.parsed === "string") {
      return { programId, programName, name: "memo", details: { memo: ix.parsed }, accounts: [] };
    }
    const info = (ix.parsed?.info ?? {}) as Record<string, unknown>;
    return { programId, programName, name: String(ix.parsed?.type ?? "unknown"), details: info, accounts: [] };
  }

  // Partially decoded: we get raw base58 data + account list and decode ourselves.
  const data = base58Decode(ix.data);
  const accountAddresses = ix.accounts.map((a) => String(a));
  let name = "unknown";
  let details: Record<string, unknown> = { dataHex: Buffer.from(data).toString("hex").slice(0, 64) };
  let roles: string[] = [];

  if (programId === COMPUTE_BUDGET_PROGRAM_ID) {
    ({ name, details } = decodeComputeBudget(data));
  } else if (programId === TOKEN_METADATA_PROGRAM_ID) {
    const known = TOKEN_METADATA_INSTRUCTIONS[data[0]];
    name = known?.name ?? `instruction #${data[0]}`;
    details = { discriminator: data[0] };
    roles = known?.accounts ?? [];
  } else if (data.length >= 8) {
    const anchorName = ANCHOR_DISCRIMINATORS.get(Buffer.from(data.subarray(0, 8)).toString("hex"));
    if (anchorName) {
      name = anchorName;
      details = { anchorDiscriminator: Buffer.from(data.subarray(0, 8)).toString("hex"), argsBytes: data.length - 8 };
    }
  }

  return {
    programId,
    programName,
    name,
    details,
    accounts: accountAddresses.map((address, i) => ({ address, role: roles[i] ?? null })),
  };
}

function flattenInstructions(tx: ParsedTransactionWithMeta, labels: Record<string, string>): TxInstructionRow[] {
  const inner = new Map<number, (ParsedInstruction | PartiallyDecodedInstruction)[]>();
  for (const group of tx.meta?.innerInstructions ?? []) inner.set(group.index, group.instructions);

  const rows: TxInstructionRow[] = [];
  tx.transaction.message.instructions.forEach((ix, i) => {
    rows.push({ path: String(i + 1), depth: 0, ...describeInstruction(ix, labels) });

    // stackHeight: 1 = top-level, 2 = CPI made by it, 3 = CPI made by that CPI...
    // Turn it into "3.1", "3.1.1", "3.2" style paths.
    const counters: number[] = [];
    for (const child of inner.get(i) ?? []) {
      const stackHeight = (child as { stackHeight?: number | null }).stackHeight ?? 2;
      const depth = Math.max(1, stackHeight - 1);
      counters.length = depth;
      counters[depth - 1] = (counters[depth - 1] ?? 0) + 1;
      rows.push({
        path: [i + 1, ...Array.from(counters.slice(0, depth), (c) => c ?? 1)].join("."),
        depth,
        ...describeInstruction(child, labels),
      });
    }
  });
  return rows;
}

function tokenBalanceChanges(tx: ParsedTransactionWithMeta, accounts: TxAccountRow[]): TokenBalanceChange[] {
  type Entry = { owner: string | null; mint: string; amount: bigint };
  const collect = (list: TokenBalance[] | null | undefined) => {
    const map = new Map<string, Entry>();
    for (const b of list ?? []) {
      map.set(`${b.accountIndex}:${b.mint}`, {
        owner: b.owner ?? null,
        mint: b.mint,
        amount: BigInt(b.uiTokenAmount.amount),
      });
    }
    return map;
  };
  const pre = collect(tx.meta?.preTokenBalances);
  const post = collect(tx.meta?.postTokenBalances);

  const changes: TokenBalanceChange[] = [];
  for (const key of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(key);
    const after = post.get(key);
    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    if (delta === 0n) continue;
    const accountIndex = Number(key.split(":")[0]);
    changes.push({
      account: accounts[accountIndex]?.address ?? `#${accountIndex}`,
      owner: after?.owner ?? before?.owner ?? null,
      mint: (after ?? before)!.mint,
      before: (before?.amount ?? 0n).toString(),
      after: (after?.amount ?? 0n).toString(),
      delta: (delta > 0n ? "+" : "") + delta.toString(),
    });
  }
  return changes;
}

function findPda(seeds: (Buffer | Uint8Array)[], programId: string): string {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0].toBase58();
}

function summarize(report: Omit<TxReport, "summary">, options: TxReportOptions): string[] {
  const lines: string[] = [];
  const payer = report.accounts.find((a) => a.feePayer);
  lines.push(
    `${report.success ? "Succeeded" : "FAILED"} · fee payer ${payer?.address ?? "?"} paid ${lamportsToSol(
      report.feeLamports
    )} SOL fee · ${report.instructions.filter((i) => i.depth === 0).length} top-level instruction(s), ${
      report.instructions.filter((i) => i.depth > 0).length
    } CPI(s)`
  );

  // fee = 5000 lamports per signature + priority fee (price per CU x CU limit).
  const budget = (name: string) =>
    report.instructions.find((i) => i.programId === COMPUTE_BUDGET_PROGRAM_ID && i.name === name)?.details;
  const price = budget("SetComputeUnitPrice")?.microLamports;
  const limit = budget("SetComputeUnitLimit")?.units;
  if (price !== undefined && limit !== undefined) {
    const baseFee = 5000 * report.signatures.length;
    const priorityFee = Math.ceil((Number(price) * Number(limit)) / 1_000_000);
    lines.push(
      `Fee breakdown: base ${baseFee} (5000 x ${report.signatures.length} signature) + priority ${priorityFee} ` +
        `(${price} microLamports/CU x ${limit} CU limit) = ${baseFee + priorityFee} lamports` +
        (baseFee + priorityFee === report.feeLamports ? "" : ` (RPC reports ${report.feeLamports})`)
    );
  }

  for (const ix of report.instructions) {
    if (ix.programId === SYSTEM_PROGRAM_ID && ix.name === "transfer" && ix.depth === 0) {
      const { source, destination, lamports } = ix.details as { source: string; destination: string; lamports: number };
      const toTreasury = options.treasuryWallet && destination === options.treasuryWallet;
      lines.push(
        `SOL transfer ${lamportsToSol(lamports)} SOL: ${source} -> ${destination}${
          toTreasury ? "  <- PetNFT mint payment (destination is TREASURY_WALLET)" : ""
        }`
      );
    }
  }

  const create = report.instructions.find((i) => i.programId === TOKEN_METADATA_PROGRAM_ID && i.name === "CreateV1");
  const mint = report.instructions.find((i) => i.programId === TOKEN_METADATA_PROGRAM_ID && i.name === "MintV1");
  if (create && mint) {
    const role = (ix: TxInstructionRow, r: string) => ix.accounts.find((a) => a.role === r)?.address ?? "?";
    const mintAddress = role(create, "mint");
    lines.push(`Metaplex NFT mint (umi createNft = CreateV1 + MintV1): mint ${mintAddress}, owner ${role(mint, "tokenOwner")}`);

    // Re-derive the PDAs ourselves — a transaction can't lie about these.
    const metaSeed = [Buffer.from("metadata"), new PublicKey(TOKEN_METADATA_PROGRAM_ID).toBuffer()];
    const mintKey = new PublicKey(mintAddress).toBuffer();
    const expectedMetadata = findPda([...metaSeed, mintKey], TOKEN_METADATA_PROGRAM_ID);
    const expectedEdition = findPda([...metaSeed, mintKey, Buffer.from("edition")], TOKEN_METADATA_PROGRAM_ID);
    const expectedAta = findPda(
      [new PublicKey(role(mint, "tokenOwner")).toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mintKey],
      ATA_PROGRAM_ID
    );
    const check = (label: string, actual: string, expected: string) =>
      `  ${actual === expected ? "OK " : "MISMATCH"} ${label} ${actual} ${actual === expected ? "== PDA" : `!= expected PDA ${expected}`}`;
    lines.push(check("metadata      ", role(create, "metadata"), expectedMetadata));
    lines.push(check("master edition", role(create, "masterEdition"), expectedEdition));
    lines.push(check("token account ", role(mint, "token"), expectedAta));
  }

  for (const change of report.tokenBalanceChanges) {
    lines.push(`Token balance ${change.delta} of mint ${change.mint} in ${change.account} (owner ${change.owner ?? "?"})`);
  }
  return lines;
}

export function buildTxReport(
  signature: string,
  tx: ParsedTransactionWithMeta,
  options: TxReportOptions = {}
): TxReport {
  const cluster = options.cluster ?? "devnet";
  const labels = { ...options.labels };
  if (options.treasuryWallet) labels[options.treasuryWallet] ??= "PetNFT treasury";

  const meta = tx.meta;
  const accounts: TxAccountRow[] = tx.transaction.message.accountKeys.map((key, index) => {
    const address = String(key.pubkey);
    const before = meta?.preBalances[index] ?? 0;
    const after = meta?.postBalances[index] ?? 0;
    return {
      index,
      address,
      label: labels[address] ?? KNOWN_ADDRESSES[address] ?? null,
      signer: key.signer,
      writable: key.writable,
      // The first signer always pays the fee.
      feePayer: index === 0,
      source: (key as { source?: string }).source ?? "transaction",
      lamportsBefore: before,
      lamportsAfter: after,
      lamportsDelta: after - before,
    };
  });

  const instructions = flattenInstructions(tx, labels);
  const invocations = new Map<string, number>();
  for (const ix of instructions) invocations.set(ix.programId, (invocations.get(ix.programId) ?? 0) + 1);

  const partial: Omit<TxReport, "summary"> = {
    signature,
    cluster,
    explorerUrl: explorerTxUrl(signature, cluster),
    slot: tx.slot,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    success: !meta?.err,
    error: meta?.err ?? null,
    version: tx.version === undefined ? "legacy" : String(tx.version),
    feeLamports: meta?.fee ?? 0,
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    recentBlockhash: tx.transaction.message.recentBlockhash,
    signatures: tx.transaction.signatures,
    accounts,
    instructions,
    programs: [...invocations.entries()].map(([programId, count]) => ({
      programId,
      name: labels[programId] ?? KNOWN_ADDRESSES[programId] ?? "Unknown program",
      invocations: count,
    })),
    tokenBalanceChanges: tokenBalanceChanges(tx, accounts),
    logs: meta?.logMessages ?? [],
  };
  return { ...partial, summary: summarize(partial, options) };
}

export async function fetchParsedTransaction(connection: Connection, signature: string) {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error(`Transaction ${signature} not found (wrong cluster, not confirmed yet, or pruned)`);
  return tx;
}

export async function fetchTxReport(
  connection: Connection,
  signature: string,
  options: TxReportOptions = {}
): Promise<TxReport> {
  return buildTxReport(signature, await fetchParsedTransaction(connection, signature), options);
}
