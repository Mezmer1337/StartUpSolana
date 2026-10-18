import type { Rarity } from "./pet";

export type ItemCategory = "FOOD" | "TOY" | "POTION" | "TRAINING" | "COSMETIC" | "MYSTIC";

export interface ItemDefinition {
  key: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: Rarity;
  icon: string;
}

export interface InventoryEntry {
  id: string;
  ownerWallet: string;
  itemId: string;
  quantity: number;
  updatedAt: string;
  item: ItemDefinition;
}
