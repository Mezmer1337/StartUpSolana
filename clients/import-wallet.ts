// Imports a Phantom private key into the CLI wallet file used by every client and test.
//
//   npm run wallet:import            (writes ~/.config/solana/id.json, or ANCHOR_WALLET)
//
// Phantom: Settings → Manage accounts → <account> → Show private key. The key is a base58 string.
// It is typed into this terminal (hidden), never passed as an argument, so it does not end up in shell history.
// The previous wallet file, if any, is kept as id.json.bak-<timestamp>.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const path = process.env.ANCHOR_WALLET ?? join(homedir(), ".config", "solana", "id.json");

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let input = "";
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input.trim());
          return;
        }
        if (char === "\u0003") process.exit(130); // Ctrl+C
        if (char === "\u0008" || char === "\u007f") input = input.slice(0, -1);
        else input += char;
      }
    });
  });
}

async function main() {
  const secret = await readHidden("Phantom private key (base58, hidden): ");
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    console.error("Not a valid Solana private key (expected the base58 string from Phantom → Show private key).");
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const backup = `${path}.bak-${Date.now()}`;
    copyFileSync(path, backup);
    console.log(`previous wallet saved to ${backup}`);
  }
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`CLI wallet is now ${keypair.publicKey.toBase58()} (${path})`);
}

main();
