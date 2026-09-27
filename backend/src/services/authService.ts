import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";
import { isValidWalletAddress } from "../middleware/validateWallet";
import { getOrCreateUser } from "./userService";

/**
 * Sign In With Solana (SIWS).
 *
 * 1. POST /auth/nonce  — the backend builds a human-readable message with a
 *    one-time nonce, bound to the site's domain and the wallet address.
 * 2. The wallet (Phantom) signs the message bytes with the wallet's private
 *    key — nothing is sent to the chain, no fee, no transaction.
 * 3. POST /auth/verify — the backend checks the ed25519 signature against
 *    the wallet's public key (a Solana address IS an ed25519 public key),
 *    burns the nonce and issues a session token.
 *
 * Every state-changing API route then requires that token, and checks the
 * wallet it acts for is the signed-in one (middleware/auth.ts).
 */

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_HOURS ?? 24 * 7) * 60 * 60 * 1000;
const CHAIN_ID = process.env.SOLANA_CLUSTER ?? "devnet";
const STATEMENT = "Sign in to PetNFT. This request will not trigger a blockchain transaction or cost any fees.";

/** Frontends allowed to request a sign-in message (the signed text names the domain). */
export function allowedOrigins(): string[] {
  return (process.env.AUTH_ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Browsers always send Origin on cross-origin requests; the message is bound
 * to it so a signature collected by another site can't be replayed here.
 * Non-browser clients (scripts, tests) get the first allowed origin.
 */
export function resolveOrigin(originHeader: string | undefined): string {
  const allowed = allowedOrigins();
  if (!originHeader) return allowed[0];
  const origin = originHeader.replace(/\/$/, "");
  if (!allowed.includes(origin)) throw new ApiError(403, `Sign-in is not allowed from origin ${origin}`);
  return origin;
}

export interface SignInMessageFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

/** Message in the SIWS / CAIP-122 text format wallets display to the user. */
export function buildSignInMessage(f: SignInMessageFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

/** ed25519 check that `signature` over `message` was made by `wallet`'s private key. */
export function verifyWalletSignature(wallet: string, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  let publicKey: Buffer;
  try {
    publicKey = new PublicKey(wallet).toBuffer();
  } catch {
    return false;
  }
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey.toString("base64url") }, format: "jwk" });
  return verifySignature(null, message, key, signature);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSignInChallenge(wallet: unknown, origin: string) {
  if (!isValidWalletAddress(wallet)) throw new ApiError(400, "Invalid wallet");

  const now = new Date();
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  const message = buildSignInMessage({
    domain: new URL(origin).host,
    address: wallet,
    statement: STATEMENT,
    uri: origin,
    chainId: CHAIN_ID,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: expiresAt.toISOString(),
  });

  await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authNonce.create({ data: { nonce, walletAddress: wallet, message, expiresAt } });
  return { nonce, message, expiresAt };
}

export async function completeSignIn(wallet: unknown, nonce: unknown, signatureBase64: unknown) {
  if (!isValidWalletAddress(wallet)) throw new ApiError(400, "Invalid wallet");
  if (typeof nonce !== "string" || typeof signatureBase64 !== "string") {
    throw new ApiError(400, "nonce and signature are required");
  }

  const challenge = await prisma.authNonce.findUnique({ where: { nonce } });
  if (!challenge || challenge.walletAddress !== wallet) throw new ApiError(401, "Unknown sign-in request — start again");
  if (challenge.usedAt) throw new ApiError(401, "This sign-in request was already used — start again");
  if (challenge.expiresAt.getTime() < Date.now()) throw new ApiError(401, "Sign-in request expired — start again");

  const signature = Buffer.from(signatureBase64, "base64");
  if (!verifyWalletSignature(wallet, Buffer.from(challenge.message, "utf8"), signature)) {
    throw new ApiError(401, "Signature does not match this wallet");
  }

  // Burn the nonce; `usedAt: null` in the filter makes a concurrent replay lose the race.
  const { count } = await prisma.authNonce.updateMany({ where: { nonce, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) throw new ApiError(401, "This sign-in request was already used — start again");

  await getOrCreateUser(wallet);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.authSession.create({ data: { tokenHash: hashToken(token), walletAddress: wallet, expiresAt } });
  return { token, wallet, expiresAt };
}

export async function getActiveSession(token: string) {
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  return { wallet: session.walletAddress, expiresAt: session.expiresAt };
}

export async function revokeSession(token: string) {
  await prisma.authSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
