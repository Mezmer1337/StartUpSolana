import { Request, Response } from "express";
import { asyncHandler, ApiError } from "../middleware/errorHandler";
import { isValidWalletAddress } from "../middleware/validateWallet";
import * as marketplaceService from "../services/marketplaceService";

export const getListings = asyncHandler(async (req: Request, res: Response) => {
  const { archetype, rarity, minPrice, maxPrice, minLevel } = req.query;
  const listings = await marketplaceService.listActiveListings({
    archetype: archetype as string | undefined,
    rarity: rarity as string | undefined,
    minPrice: minPrice ? Number(minPrice) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    minLevel: minLevel ? Number(minLevel) : undefined,
  });
  res.json(listings);
});

export const createListing = asyncHandler(async (req: Request, res: Response) => {
  const { sellerWallet, petId, priceSol } = req.body;
  if (!isValidWalletAddress(sellerWallet)) throw new ApiError(400, "Invalid sellerWallet");
  if (!petId || typeof priceSol !== "number") throw new ApiError(400, "petId and priceSol are required");
  const listing = await marketplaceService.listPetForSale(sellerWallet, petId, priceSol);
  res.status(201).json(listing);
});

export const cancelListing = asyncHandler(async (req: Request, res: Response) => {
  const { sellerWallet } = req.body;
  if (!isValidWalletAddress(sellerWallet)) throw new ApiError(400, "Invalid sellerWallet");
  const listing = await marketplaceService.cancelListing(sellerWallet, req.params.id);
  res.json(listing);
});

export const reserveListing = asyncHandler(async (req: Request, res: Response) => {
  const { buyerWallet } = req.body;
  if (!isValidWalletAddress(buyerWallet)) throw new ApiError(400, "Invalid buyerWallet");
  res.json(await marketplaceService.reserveListing(buyerWallet, req.params.id));
});

export const buyListing = asyncHandler(async (req: Request, res: Response) => {
  const { buyerWallet, listingId, txSignature } = req.body;
  if (!isValidWalletAddress(buyerWallet)) throw new ApiError(400, "Invalid buyerWallet");
  if (!listingId) throw new ApiError(400, "listingId is required");
  if (typeof txSignature !== "string" || !txSignature) throw new ApiError(400, "txSignature is required");
  const result = await marketplaceService.buyListing(buyerWallet, listingId, txSignature);
  res.json(result);
});
