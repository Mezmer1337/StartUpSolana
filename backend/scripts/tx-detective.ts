// Transaction Detective CLI (course week 2).
//
//   npx tsx scripts/tx-detective.ts <signature>                  analyze a devnet transaction
//   npx tsx scripts/tx-detective.ts <signature> --logs           ...and print program logs
//   npx tsx scripts/tx-detective.ts <signature> --json           machine-readable report
//   npx tsx scripts/tx-detective.ts <signature> --save tx.json   save the raw RPC transaction
//   npx tsx scripts/tx-detective.ts --file tx.json               analyze a saved transaction offline
//   npx tsx scripts/tx-detective.ts --recent <address> [--limit 10]   find transactions to analyze
//
// Options: --cluster devnet|testnet|mainnet-beta|<rpc url> (default: devnet, or SOLANA_RPC_URL)

import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import {
  buildTxReport,
  fetchParsedTransaction,
  TxReport,
  TxReportOptions,
} from "../src/services/txDetectiveService";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_OPTIONS = new Set(["--cluster", "--save", "--file", "--recent", "--limit"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.has(args[i - 1]));

const clusterArg = option("cluster");
const cluster = clusterArg && !clusterArg.startsWith("http") ? clusterArg : "devnet";
const rpcUrl = clusterArg?.startsWith("http")
  ? clusterArg
  : clusterArg
  ? clusterApiUrl(clusterArg as "devnet" | "testnet" | "mainnet-beta")
  : process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

const reportOptions: TxReportOptions = {
  cluster,
  treasuryWallet: process.env.TREASURY_WALLET,
  passportProgramId: process.env.PET_PASSPORT_PROGRAM_ID,
  labels: Object.fromEntries(
    [
      [process.env.PROGRAM_ID, "PetNFT program (petnft)"],
      [process.env.PET_PASSPORT_PROGRAM_ID, "PetNFT pet_passport (native)"],
      [process.env.PET_COUNTER_PROGRAM_ID, "PetNFT pet_counter (Anchor)"],
    ].filter(([address]) => address) as [string, string][]
  ),
};

const sol = (lamports: number) => `${lamports / LAMPORTS_PER_SOL}`;
const signed = (lamports: number) => (lamports > 0 ? "+" : "") + sol(lamports);

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ");
}

function print(report: TxReport, showLogs: boolean) {
  const line = "-".repeat(100);
  console.log(`\nTRANSACTION ${report.signature}`);
  console.log(
    `${report.cluster} · slot ${report.slot} · ${report.blockTime ?? "no block time"} · ${report.version} tx · fee ${sol(
      report.feeLamports
    )} SOL · ${report.computeUnitsConsumed ?? "?"} compute units`
  );
  console.log(`status: ${report.success ? "SUCCESS" : `FAILED ${JSON.stringify(report.error)}`}`);
  console.log(`explorer: ${report.explorerUrl}`);

  console.log(`\nSUMMARY\n${line}`);
  for (const s of report.summary) console.log(`  ${s}`);

  console.log(`\nACCOUNTS — who the transaction touches (S=signer W=writable F=fee payer L=lookup table)\n${line}`);
  for (const a of report.accounts) {
    const flags = [a.signer ? "S" : "-", a.writable ? "W" : "-", a.feePayer ? "F" : "-", a.source === "lookupTable" ? "L" : "-"].join("");
    const change = a.lamportsDelta === 0 ? "" : `${sol(a.lamportsBefore)} -> ${sol(a.lamportsAfter)} (${signed(a.lamportsDelta)} SOL)`;
    console.log(`  ${String(a.index).padStart(2)}  ${a.address.padEnd(44)}  ${flags}  ${(a.label ?? "").padEnd(26)} ${change}`);
  }

  console.log(`\nINSTRUCTIONS — what runs, in order (indented = CPI made by the instruction above)\n${line}`);
  for (const ix of report.instructions) {
    const indent = "  ".repeat(ix.depth);
    console.log(`  ${indent}${ix.path.padEnd(7)} ${ix.programName} :: ${ix.name}`);
    const details = formatDetails(ix.details);
    if (details) console.log(`  ${indent}        ${details}`);
    for (const acc of ix.accounts.filter((a) => a.role)) {
      console.log(`  ${indent}        ${acc.role!.padEnd(18)} ${acc.address}`);
    }
  }

  console.log(`\nPROGRAMS — who executes the instructions\n${line}`);
  for (const p of report.programs) {
    console.log(`  ${p.programId.padEnd(44)}  ${p.name.padEnd(28)} x${p.invocations}`);
  }

  if (report.tokenBalanceChanges.length) {
    console.log(`\nTOKEN BALANCE CHANGES\n${line}`);
    for (const t of report.tokenBalanceChanges) {
      console.log(`  ${t.account}  mint ${t.mint}  ${t.before} -> ${t.after} (${t.delta})`);
    }
  }

  if (showLogs) {
    console.log(`\nLOGS\n${line}`);
    for (const log of report.logs) console.log(`  ${log}`);
  }
  console.log();
}

async function main() {
  const connection = new Connection(rpcUrl, "confirmed");

  const recent = option("recent");
  if (recent) {
    const limit = Number(option("limit") ?? 10);
    const sigs = await connection.getSignaturesForAddress(new PublicKey(recent), { limit });
    for (const s of sigs) {
      const time = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "";
      console.log(`${s.signature}  ${s.err ? "FAILED " : "ok     "} slot ${s.slot}  ${time}`);
    }
    return;
  }

  const file = option("file");
  let tx: ParsedTransactionWithMeta;
  let signature: string;
  if (file) {
    tx = JSON.parse(readFileSync(file, "utf8"));
    signature = tx.transaction.signatures[0];
  } else {
    signature = positional[0];
    if (!signature) {
      console.error("Usage: npx tsx scripts/tx-detective.ts <signature> [--cluster devnet] [--logs] [--json] [--save file]");
      console.error("       npx tsx scripts/tx-detective.ts --file tx.json | --recent <address> [--limit 10]");
      process.exit(1);
    }
    tx = await fetchParsedTransaction(connection, signature);
  }

  const save = option("save");
  if (save) {
    writeFileSync(save, JSON.stringify(tx, null, 2) + "\n");
    console.log(`Saved raw transaction to ${save}`);
  }

  const report = buildTxReport(signature, tx, reportOptions);
  if (flag("json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report, flag("logs"));
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
