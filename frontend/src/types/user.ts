import type { InventoryEntry } from "./item";
import type { Pet } from "./pet";

export interface UserAccount {
  id: string;
  walletAddress: string;
  accountLevel: number;
  accountXp: number;
  petCoins: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  user: UserAccount;
  pets: Pet[];
  inventory: InventoryEntry[];
  petCount: number;
  nftCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  petId: string;
  petName: string;
  petType: string;
  /** Raw DNA columns the shared renderer needs to draw the portrait. */
  art: {
    seedHash: string;
    rarity: string;
    look: string | null;
    auraType: string | null;
    level: number;
  };
  rarity: string;
  level: number;
  xp: number;
}
