import type { Pet } from "./pet";

export type ListingStatus = "ACTIVE" | "SOLD" | "CANCELLED";

export interface MarketplaceListing {
  id: string;
  petId: string;
  sellerWallet: string;
  priceSol: number;
  status: ListingStatus;
  /** Set while a buyer is paying for it (a few minutes). */
  reservedBy: string | null;
  reservedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  pet: Pet;
}
