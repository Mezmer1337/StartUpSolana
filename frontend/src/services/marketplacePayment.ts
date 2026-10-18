import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export interface SaleTransfer {
  to: string;
  lamports: number;
  label: string;
}

/**
 * Pays for a marketplace pet with ONE wallet-signed transaction holding one
 * SOL transfer per recipient (seller's share + platform fees). The buyer
 * approves the exact amounts in Phantom; the backend then re-reads this
 * transaction on devnet before handing the pet over
 * (backend marketplaceService.buyListing → verifySolTransfers).
 */
export async function payForListing(connection: Connection, wallet: WalletContextState, transfers: SaleTransfer[]): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) throw new Error("Connect your wallet first");

  const tx = new Transaction();
  for (const t of transfers) {
    if (t.lamports <= 0) continue;
    tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(t.to), lamports: t.lamports }));
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  const signature = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

/** Ask every useWalletBalance() to re-read the balance now (after a payment). */
export const refreshWalletBalance = () => window.dispatchEvent(new Event("wallet-balance-refresh"));
