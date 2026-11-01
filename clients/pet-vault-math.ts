// Off-chain mirror of programs/pet_vault: PDA addresses and the share exchange rate.
// Shared by clients/pet-vault.ts and tests/pet-vault.ts; must match shares_for_assets / assets_for_shares in lib.rs.

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const VIRTUAL_SHARES = 1_000n;
export const VIRTUAL_ASSETS = 1_000n;

/** shares = assets * (supply + V) / (total_assets + V), rounded down. */
export const sharesForAssets = (assets: bigint, totalAssets: bigint, supply: bigint) =>
  (assets * (supply + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);

/** assets = shares * (total_assets + V) / (supply + V), rounded down. */
export const assetsForShares = (shares: bigint, totalAssets: bigint, supply: bigint) =>
  (shares * (totalAssets + VIRTUAL_ASSETS)) / (supply + VIRTUAL_SHARES);

/** Lowest acceptable result: `quote` minus `bps` basis points. */
export const withSlippage = (quote: bigint, bps: number) => (quote * BigInt(10_000 - bps)) / 10_000n;

export function vaultAddresses(programId: PublicKey, assetMint: PublicKey, tokenProgram: PublicKey) {
  const [address] = PublicKey.findProgramAddressSync([Buffer.from("vault"), assetMint.toBuffer()], programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("shares"), address.toBuffer()], programId);
  // allowOwnerOffCurve: the owner is a PDA, which by definition is not on the ed25519 curve.
  const vaultTokens = getAssociatedTokenAddressSync(assetMint, address, true, tokenProgram);
  return { address, shareMint, vaultTokens };
}
