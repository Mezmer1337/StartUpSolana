import { clusterApiUrl } from "@solana/web3.js";

export const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK as string) || "devnet";

export const SOLANA_RPC_URL =
  (import.meta.env.VITE_SOLANA_RPC_URL as string) || clusterApiUrl("devnet");

const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:4000/api";

/**
 * Public URL the NFT metadata is served from — it gets baked into the NFT
 * on-chain, so it must be absolute. A relative API base ("/api", the
 * single-service deploy) means "this same site".
 */
export const METADATA_BASE_URL =
  (import.meta.env.VITE_METADATA_STORAGE_URL as string) ||
  (apiBase.startsWith("/") ? window.location.origin : apiBase.replace(/\/api$/, ""));
