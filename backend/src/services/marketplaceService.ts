import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";
import { assertOwnership, getPetById } from "./petService";
import { getOrCreateUser } from "./userService";
import { getTreasuryWallet, verifySolTransfers } from "./solanaVerifyService";

/** How long a buyer holds a listing while approving the payment in Phantom. */
export const RESERVATION_MS = 3 * 60 * 1000;
const LAMPORTS_PER_SOL = 1_000_000_000;

// Configurable marketplace economy knobs (brief section 23). Expressed in
// basis points (1/100 of a percent) so they're easy to tune precisely.
// Both are deducted from the sale price; the remainder goes to the seller.
export const MARKETPLACE_FEE_BPS = 250; // 2.5% platform fee -> treasury
export const MARKETPLACE_ROYALTY_BPS = 250; // 2.5% "creator" royalty -> treasury

export function computeSaleBreakdown(priceSol: number) {
  const platformFeeSol = Number(((priceSol * MARKETPLACE_FEE_BPS) / 10_000).toFixed(6));
  const royaltySol = Number(((priceSol * MARKETPLACE_ROYALTY_BPS) / 10_000).toFixed(6));
  const sellerProceedsSol = Number((priceSol - platformFeeSol - royaltySol).toFixed(6));
  return { priceSol, platformFeeSol, royaltySol, sellerProceedsSol };
}

/** The same split in lamports: integer maths, so what we ask for is exactly what we verify. */
export function computeSaleLamports(priceSol: number) {
  const total = Math.round(priceSol * LAMPORTS_PER_SOL);
  const fees = Math.floor((total * (MARKETPLACE_FEE_BPS + MARKETPLACE_ROYALTY_BPS)) / 10_000);
  return { total, sellerLamports: total - fees, treasuryLamports: fees };
}

const reservationActive = (l: { reservedUntil: Date | null }) => !!l.reservedUntil && l.reservedUntil.getTime() > Date.now();

export interface MarketplaceFilters {
  archetype?: string;
  rarity?: string;
  minPrice?: number;
  maxPrice?: number;
  minLevel?: number;
}

export async function listActiveListings(filters: MarketplaceFilters) {
  return prisma.marketplaceListing.findMany({
    where: {
      status: "ACTIVE",
      priceSol: {
        gte: filters.minPrice ?? undefined,
        lte: filters.maxPrice ?? undefined,
      },
      pet: {
        archetype: filters.archetype ?? undefined,
        rarity: (filters.rarity as any) ?? undefined,
        level: filters.minLevel ? { gte: filters.minLevel } : undefined,
      },
    },
    include: { pet: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Lists a pet for sale.
 *
 * MVP NOTE: this only records intent-to-sell in the backend database. A
 * production marketplace would escrow the NFT (or use an on-chain listing
 * account) so the seller cannot transfer/relist it elsewhere while listed.
 * See README "MVP / mock" section.
 */
export async function listPetForSale(sellerWallet: string, petId: string, priceSol: number) {
  if (priceSol <= 0) throw new ApiError(400, "Price must be greater than 0");
  const pet = await getPetById(petId);
  assertOwnership(pet, sellerWallet);

  const existing = await prisma.marketplaceListing.findFirst({
    where: { petId, status: "ACTIVE" },
  });
  if (existing) throw new ApiError(409, "Pet is already listed");

  const listing = await prisma.marketplaceListing.create({
    data: { petId, sellerWallet, priceSol },
  });

  await prisma.transaction.create({
    data: { type: "LIST", petId, walletAddress: sellerWallet, priceSol },
  });

  return listing;
}

export async function cancelListing(sellerWallet: string, listingId: string) {
  const listing = await prisma.marketplaceListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new ApiError(404, "Listing not found");
  if (listing.sellerWallet !== sellerWallet) throw new ApiError(403, "Not your listing");
  if (listing.status !== "ACTIVE") throw new ApiError(400, "Listing is not active");
  // A buyer may be signing the payment right now: don't pull the pet from under them.
  if (reservationActive(listing)) throw new ApiError(409, "A buyer is paying for this pet right now. Try again in a few minutes");

  return prisma.marketplaceListing.update({
    where: { id: listingId },
    data: { status: "CANCELLED" },
  });
}

/**
 * Step 1 of a purchase: hold the listing for this buyer for a few minutes
 * and tell the frontend exactly what to pay, to whom. Two people can't both
 * send SOL for the same pet: the second one is refused here, before paying.
 */
export async function reserveListing(buyerWallet: string, listingId: string) {
  const listing = await prisma.marketplaceListing.findUnique({ where: { id: listingId } });
  if (!listing) throw new ApiError(404, "Listing not found");
  if (listing.status !== "ACTIVE") throw new ApiError(400, "This pet is no longer for sale");
  if (listing.sellerWallet === buyerWallet) throw new ApiError(400, "Cannot buy your own listing");

  const reservedUntil = new Date(Date.now() + RESERVATION_MS);
  // Conditional update, so two simultaneous reservations can't both win.
  const { count } = await prisma.marketplaceListing.updateMany({
    where: {
      id: listingId,
      status: "ACTIVE",
      OR: [{ reservedUntil: null }, { reservedUntil: { lt: new Date() } }, { reservedBy: buyerWallet }],
    },
    data: { reservedBy: buyerWallet, reservedUntil },
  });
  if (count === 0) throw new ApiError(409, "Another buyer is paying for this pet right now. Try again in a few minutes");

  const { total, sellerLamports, treasuryLamports } = computeSaleLamports(listing.priceSol);
  return {
    listingId,
    reservedUntil,
    payment: {
      totalLamports: total,
      transfers: [
        { to: listing.sellerWallet, lamports: sellerLamports, label: "seller" },
        { to: getTreasuryWallet(), lamports: treasuryLamports, label: "fees" },
      ],
    },
    breakdown: computeSaleBreakdown(listing.priceSol),
  };
}

/**
 * Step 2: the buyer has paid on-chain in one transaction (seller's share to
 * the seller, platform fee + royalty to the treasury). The backend reads that
 * transaction from Solana devnet itself and only then hands the pet over, so
 * SOL really leaves the buyer's wallet and lands in the seller's.
 */
export async function buyListing(buyerWallet: string, listingId: string, txSignature?: string) {
  if (!txSignature) throw new ApiError(400, "txSignature is required: pay for the pet in your wallet first");
  const listing = await prisma.marketplaceListing.findUnique({ where: { id: listingId }, include: { pet: true } });
  if (!listing) throw new ApiError(404, "Listing not found");
  if (listing.status !== "ACTIVE") throw new ApiError(400, "Listing is not active");
  if (listing.sellerWallet === buyerWallet) throw new ApiError(400, "Cannot buy your own listing");
  if (listing.reservedBy !== buyerWallet || !listing.reservedUntil) {
    throw new ApiError(409, "Reserve the listing before paying");
  }
  const used = await prisma.marketplaceListing.findUnique({ where: { paymentSignature: txSignature } });
  if (used) throw new ApiError(409, "This payment was already used for another purchase");

  const { sellerLamports, treasuryLamports } = computeSaleLamports(listing.priceSol);
  // The reservation started RESERVATION_MS before reservedUntil: the payment must be newer.
  const reservedAt = new Date(listing.reservedUntil.getTime() - RESERVATION_MS);
  await verifySolTransfers(
    txSignature,
    buyerWallet,
    [
      { wallet: listing.sellerWallet, lamports: sellerLamports },
      { wallet: getTreasuryWallet(), lamports: treasuryLamports },
    ],
    reservedAt
  );
  // A paid buyer is honoured even if the reservation timed out meanwhile:
  // the money already reached the seller on-chain.

  await getOrCreateUser(buyerWallet);
  const breakdown = computeSaleBreakdown(listing.priceSol);

  const [, , updatedPet] = await prisma.$transaction([
    prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { status: "SOLD", paymentSignature: txSignature, reservedBy: null, reservedUntil: null },
    }),
    prisma.transaction.create({
      data: {
        type: "BUY",
        petId: listing.petId,
        walletAddress: buyerWallet,
        counterparty: listing.sellerWallet,
        priceSol: listing.priceSol,
      },
    }),
    prisma.pet.update({ where: { id: listing.petId }, data: { ownerWallet: buyerWallet } }),
  ]);

  return { listing, pet: updatedPet, txSignature, breakdown };
}
