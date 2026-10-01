import * as anchor from "@anchor-lang/core";
import type { ConfirmOptions, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * AnchorProvider for the test suites.
 *
 * - "confirmed" instead of the default "processed": tests read transaction
 *   logs back (getTransaction needs >= confirmed).
 * - Retries "Blockhash not found": public devnet RPC load-balances across
 *   nodes, so the blockhash can come from one node and the simulation run on
 *   another that hasn't seen it yet. Not a program error — just resend.
 */
class RetryingProvider extends anchor.AnchorProvider {
  async sendAndConfirm(tx: Transaction | VersionedTransaction, signers?: Signer[], opts?: ConfirmOptions) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await super.sendAndConfirm(tx, signers, opts);
      } catch (err) {
        if (attempt >= 5 || !/Blockhash not found/i.test(String(err))) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

export function testProvider(wallet?: anchor.Wallet): anchor.AnchorProvider {
  const env = anchor.AnchorProvider.env();
  return new RetryingProvider(env.connection, wallet ?? env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}
