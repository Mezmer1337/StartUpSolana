import axios from "axios";
import type { Pet, PetActionResult, PetType } from "../types/pet";
import type { InventoryEntry, ItemDefinition } from "../types/item";
import type { MarketplaceListing } from "../types/marketplace";
import type { LeaderboardEntry, UserProfile } from "../types/user";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export const api = axios.create({ baseURL: API_BASE_URL });

// ---- Session token from Sign In With Solana (see context/AuthContext.tsx) ----

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called when the backend rejects our session token (expired or revoked). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

api.interceptors.response.use(undefined, (error) => {
  if (axios.isAxiosError(error) && error.response?.status === 401 && error.config?.headers?.Authorization) {
    onUnauthorized?.();
  }
  return Promise.reject(error);
});

export interface AuthSession {
  token: string;
  wallet: string;
  expiresAt: string;
}

export const authApi = {
  nonce: (wallet: string) =>
    api.post<{ nonce: string; message: string; expiresAt: string }>("/auth/nonce", { wallet }).then((r) => r.data),
  verify: (wallet: string, nonce: string, signature: string) =>
    api.post<AuthSession>("/auth/verify", { wallet, nonce, signature }).then((r) => r.data),
  session: () => api.get<{ wallet: string }>("/auth/session").then((r) => r.data),
  logout: () => api.post("/auth/logout"),
};

export interface MintPetResult {
  pet: Pet;
  pricePaidSol: number;
}

export const petApi = {
  // Rarity/DNA/traits are intentionally not part of this input — they're
  // generated server-side (see backend petService.mintPet) so none of it
  // can be forged. paymentTxSignature must be a confirmed on-chain SOL
  // transfer to the treasury wallet paying at least the current mint price.
  mint: (input: { ownerWallet: string; name: string; type: PetType; color?: string; paymentTxSignature: string }) =>
    api.post<MintPetResult>("/pets/mint", input).then((r) => r.data),

  getByWallet: (wallet: string) => api.get<Pet[]>(`/pets/wallet/${wallet}`).then((r) => r.data),

  getById: (id: string) => api.get<Pet>(`/pets/${id}`).then((r) => r.data),

  feed: (id: string, ownerWallet: string) =>
    api.post<PetActionResult>(`/pets/${id}/feed`, { ownerWallet }).then((r) => r.data),

  play: (id: string, ownerWallet: string) =>
    api.post<PetActionResult>(`/pets/${id}/play`, { ownerWallet }).then((r) => r.data),

  rest: (id: string, ownerWallet: string) =>
    api.post<PetActionResult>(`/pets/${id}/rest`, { ownerWallet }).then((r) => r.data),

  train: (id: string, ownerWallet: string, stat: "strength" | "speed") =>
    api.post<PetActionResult>(`/pets/${id}/train`, { ownerWallet, stat }).then((r) => r.data),

  equip: (id: string, ownerWallet: string, itemKey: string | null) =>
    api.post<Pet>(`/pets/${id}/equip`, { ownerWallet, itemKey }).then((r) => r.data),

  recordMint: (id: string, ownerWallet: string, mintAddress: string, metadataUri: string) =>
    api.post<Pet>(`/pets/${id}/mint`, { ownerWallet, mintAddress, metadataUri }).then((r) => r.data),
};

export const inventoryApi = {
  get: (wallet: string) => api.get<InventoryEntry[]>(`/inventory/${wallet}`).then((r) => r.data),

  use: (ownerWallet: string, petId: string, itemKey: string) =>
    api.post<Pet>("/inventory/use", { ownerWallet, petId, itemKey }).then((r) => r.data),
};

export const itemApi = {
  catalog: () => api.get<ItemDefinition[]>("/items").then((r) => r.data),
};

export interface MintPriceQuote {
  priceSol: number;
  totalMinted: number;
  mintedLastHour: number;
  mintedLast24h: number;
  demandMultiplier: number;
  supplyMultiplier: number;
  computedAt: string;
  treasuryWallet: string | null;
}

export const economyApi = {
  getMintPrice: () => api.get<MintPriceQuote>("/economy/mint-price").then((r) => r.data),
};

export interface GameDefinition {
  key: string;
  name: string;
  description: string;
  maxScore: number;
}

export interface GameCompleteResult {
  score: number;
  xpAwarded: number;
  coinsAwarded: number;
  accountLeveledUp: boolean;
  pet: PetActionResult | null;
}

export const gamesApi = {
  list: () => api.get<GameDefinition[]>("/games").then((r) => r.data),
  complete: (gameKey: string, wallet: string, score: number, petId?: string) =>
    api.post<GameCompleteResult>(`/games/${gameKey}/complete`, { wallet, score, petId }).then((r) => r.data),
};

export interface QuestEntry {
  key: string;
  name: string;
  description: string;
  type: "DAILY" | "WEEKLY" | "ACHIEVEMENT";
  target: number;
  progress: number;
  reward: { xp: number; petCoins: number; itemKey?: string };
  claimed: boolean;
  canClaim: boolean;
}

export const questsApi = {
  list: (wallet: string) => api.get<QuestEntry[]>("/quests", { params: { wallet } }).then((r) => r.data),
  complete: (questKey: string, wallet: string) =>
    api.post(`/quests/${questKey}/complete`, { wallet }).then((r) => r.data),
};

export interface MarketplaceFilters {
  type?: string;
  rarity?: string;
  minPrice?: number;
  maxPrice?: number;
  minLevel?: number;
}

export const marketplaceApi = {
  list: (filters: MarketplaceFilters = {}) =>
    api.get<MarketplaceListing[]>("/marketplace", { params: filters }).then((r) => r.data),

  create: (sellerWallet: string, petId: string, priceSol: number) =>
    api.post<MarketplaceListing>("/marketplace/list", { sellerWallet, petId, priceSol }).then((r) => r.data),

  cancel: (sellerWallet: string, listingId: string) =>
    api.post(`/marketplace/${listingId}/cancel`, { sellerWallet }).then((r) => r.data),

  buy: (buyerWallet: string, listingId: string, txSignature?: string) =>
    api.post("/marketplace/buy", { buyerWallet, listingId, txSignature }).then((r) => r.data),
};

export const leaderboardApi = {
  get: (limit = 50) => api.get<LeaderboardEntry[]>("/leaderboard", { params: { limit } }).then((r) => r.data),
};

export const userApi = {
  getProfile: (wallet: string) => api.get<UserProfile>(`/user/${wallet}`).then((r) => r.data),
};

export const dailyRewardApi = {
  status: (wallet: string) =>
    api.get<{ canClaim: boolean; nextAvailableAt: string | null }>(`/daily-reward/${wallet}`).then((r) => r.data),

  claim: (walletAddress: string) =>
    api
      .post<{ itemKey: string; claim: unknown; leveledUp: boolean; newAccountLevel: number }>(
        "/daily-reward/claim",
        { walletAddress }
      )
      .then((r) => r.data),
};

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.data?.error) {
    return err.response.data.error as string;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
