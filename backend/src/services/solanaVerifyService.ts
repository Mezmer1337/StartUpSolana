import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const TREASURY_WALLET = process.env.TREASURY_WALLET;

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) connection = new Connection(SOLANA_RPC_URL, "confirmed");
  return connection;
}

export function getTreasuryWallet(): string {
  if (!TREASURY_WALLET) {
    throw new ApiError(
      500,
      "TREASURY_WALLET is not configured on the backend — set it in backend/.env (see .env.example)"
    );
  }
  return TREASURY_WALLET;
}

/**
 * Verifies, directly against Solana Devnet, that `signature` is a
 * confirmed transaction paying at least `minLamports` from `payerWallet`
 * to the treasury wallet — then records the signature so it can never be
 * reused for a second mint (replay protection). This is the real
 * trust boundary for "did the player actually pay": the backend does not
 * take the frontend's word for it, it reads the chain itself.
 */
export async function verifyAndConsumeMintPayment(
  signature: string,
  payerWallet: string,
  minLamports: number
): Promise<void> {
  const existing = await prisma.mintPayment.findUnique({ where: { signature } });
  if (existing) {
    throw new ApiError(409, "This payment transaction has already been used for a mint");
  }

  const conn = getConnection();
  const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) {
    throw new ApiError(400, "Payment transaction not found on devnet (not confirmed yet, or invalid signature)");
  }
  if (tx.meta?.err) {
    throw new ApiError(400, "Payment transaction failed on-chain");
  }

  const treasury = getTreasuryWallet();
  const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());

  const payerIndex = accountKeys.indexOf(payerWallet);
  const treasuryIndex = accountKeys.indexOf(treasury);

  if (payerIndex === -1 || treasuryIndex === -1 || !tx.meta) {
    throw new ApiError(400, "Payment transaction does not involve the expected payer and treasury accounts");
  }

  // The treasury owner playing with their own wallet: paying yourself is a no-op
  // (the balance only drops by the network fee), so there's no amount to check —
  // only that they really signed a successful transaction. Anyone else must pay.
  if (payerWallet === treasury) {
    if (!tx.transaction.message.isAccountSigner(payerIndex)) {
      throw new ApiError(400, "Payment was not signed by the payer's wallet");
    }
    await prisma.mintPayment.create({ data: { signature, walletAddress: payerWallet, lamports: 0 } });
    return;
  }

  const treasuryDelta = tx.meta.postBalances[treasuryIndex] - tx.meta.preBalances[treasuryIndex];
  const payerDelta = tx.meta.preBalances[payerIndex] - tx.meta.postBalances[payerIndex];

  if (treasuryDelta < minLamports || payerDelta < minLamports) {
    throw new ApiError(
      400,
      `Payment amount too low: paid ${treasuryDelta / LAMPORTS_PER_SOL} SOL, required at least ${
        minLamports / LAMPORTS_PER_SOL
      } SOL`
    );
  }

  await prisma.mintPayment.create({
    data: { signature, walletAddress: payerWallet, lamports: treasuryDelta },
  });
}

/** The RPC can lag a moment behind the wallet's own confirmation — retry briefly. */
async function fetchConfirmedTx(signature: string) {
  const conn = getConnection();
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/**
 * Verifies against Solana Devnet that `signature` is a confirmed, successful
 * transaction signed by `payerWallet` in which every recipient received at
 * least its lamports (balance deltas, so it works for one tx with several
 * transfers). `notBefore` rejects old transfers being passed off as new.
 * Replay protection is the caller's job (store the signature uniquely).
 */
export async function verifySolTransfers(
  signature: string,
  payerWallet: string,
  recipients: { wallet: string; lamports: number }[],
  notBefore?: Date
): Promise<void> {
  const tx = await fetchConfirmedTx(signature);
  if (!tx || !tx.meta) throw new ApiError(400, "Payment transaction not found on devnet (not confirmed yet, or invalid signature)");
  if (tx.meta.err) throw new ApiError(400, "Payment transaction failed on-chain");
  if (notBefore && tx.blockTime && tx.blockTime * 1000 < notBefore.getTime() - 60_000) {
    throw new ApiError(400, "Payment transaction is older than this purchase");
  }

  const message = tx.transaction.message;
  const keys = message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
  const payerIndex = keys.indexOf(payerWallet);
  if (payerIndex === -1 || !message.isAccountSigner(payerIndex)) {
    throw new ApiError(400, "Payment was not signed by the buyer's wallet");
  }

  // Merge recipients that are the same wallet (e.g. seller == treasury). A share
  // the payer owes to themself (the treasury owner buying) is a no-op — skip it.
  const expected = new Map<string, number>();
  for (const r of recipients) {
    if (r.wallet === payerWallet) continue;
    expected.set(r.wallet, (expected.get(r.wallet) ?? 0) + r.lamports);
  }

  let total = 0;
  for (const [wallet, lamports] of expected) {
    const i = keys.indexOf(wallet);
    const received = i === -1 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i];
    if (received < lamports) {
      throw new ApiError(
        400,
        `Payment to ${wallet.slice(0, 4)}…${wallet.slice(-4)} too low: ${received / LAMPORTS_PER_SOL} SOL, expected ${lamports / LAMPORTS_PER_SOL} SOL`
      );
    }
    total += lamports;
  }
  const paid = tx.meta.preBalances[payerIndex] - tx.meta.postBalances[payerIndex];
  if (paid < total) throw new ApiError(400, "The buyer's wallet did not pay the full amount");
}

export function isValidPublicKey(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}
