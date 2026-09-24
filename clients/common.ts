import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";

/** RPC endpoint: SOLANA_RPC_URL, else ANCHOR_PROVIDER_URL, else public devnet. */
export const RPC_URL = process.env.SOLANA_RPC_URL ?? process.env.ANCHOR_PROVIDER_URL ?? clusterApiUrl("devnet");

export function connection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

/** The CLI wallet (`solana-keygen new` writes it to ~/.config/solana/id.json). */
export function loadKeypair(path = process.env.ANCHOR_WALLET ?? join(homedir(), ".config", "solana", "id.json")): Keypair {
  if (!existsSync(path)) {
    throw new Error(`Wallet keypair not found at ${path}. Create one with \`solana-keygen new\` or set ANCHOR_WALLET.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** Program id of a program deployed from `keypairPath` (what `solana program deploy` uses). */
export function programIdFromKeypair(keypairPath: string): PublicKey | null {
  if (!existsSync(keypairPath)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")))).publicKey;
}

function explorerQuery(): string {
  if (RPC_URL.includes("devnet")) return "?cluster=devnet";
  if (RPC_URL.includes("testnet")) return "?cluster=testnet";
  if (RPC_URL.includes("mainnet")) return "";
  return `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}${explorerQuery()}`;
export const explorerAddress = (address: PublicKey | string) =>
  `https://explorer.solana.com/address/${address.toString()}${explorerQuery()}`;

/** `--name value` style options; positional[0] is the command. */
export function parseArgs(argv = process.argv.slice(2)) {
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) options.set(argv[i].slice(2), argv[++i] ?? "");
    else positional.push(argv[i]);
  }
  return { command: positional[0], option: (name: string) => options.get(name) };
}
