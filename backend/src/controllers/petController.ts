import { Request, Response } from "express";
import { asyncHandler, ApiError } from "../middleware/errorHandler";
import { isValidWalletAddress } from "../middleware/validateWallet";
import * as petService from "../services/petService";
import * as trainingService from "../services/trainingService";

// Archetype, rarity, DNA and traits are deliberately NOT accepted from the
// client — the player buys an egg and gets whatever hatches. They're
// generated server-side in petService.mintPet() so none of it can
// be forged. Minting also requires a verified on-chain SOL payment.
export const mintPet = asyncHandler(async (req: Request, res: Response) => {
  const { ownerWallet, name, paymentTxSignature } = req.body;
  if (!isValidWalletAddress(ownerWallet)) throw new ApiError(400, "Invalid ownerWallet");
  if (name !== undefined && typeof name !== "string") throw new ApiError(400, "name must be a string");
  if (!paymentTxSignature || typeof paymentTxSignature !== "string") {
    throw new ApiError(400, "paymentTxSignature is required — pay the current mint price first");
  }

  const result = await petService.mintPet({ ownerWallet, name, paymentTxSignature });
  res.status(201).json(result);
});

export const getPetsForWallet = asyncHandler(async (req: Request, res: Response) => {
  const { wallet } = req.params;
  if (!isValidWalletAddress(wallet)) throw new ApiError(400, "Invalid wallet");
  const pets = await petService.getPetsForWallet(wallet);
  res.json(pets);
});

export const getPet = asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.getPetById(req.params.id);
  res.json(pet);
});

function requireCaller(req: Request): string {
  const wallet = req.body?.ownerWallet;
  if (!isValidWalletAddress(wallet)) throw new ApiError(400, "Invalid ownerWallet");
  return wallet;
}

export const feedPet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const pet = await petService.getPetById(req.params.id);
  petService.assertOwnership(pet, wallet);
  const result = await petService.feedPet(pet);
  res.json(result);
});

export const playWithPet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const pet = await petService.getPetById(req.params.id);
  petService.assertOwnership(pet, wallet);
  const result = await petService.playWithPet(pet);
  res.json(result);
});

export const restPet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const pet = await petService.getPetById(req.params.id);
  petService.assertOwnership(pet, wallet);
  const updated = await petService.restPet(pet);
  res.json({ pet: updated, leveledUp: false });
});

export const trainPet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const stat = req.body?.stat;
  if (stat !== "strength" && stat !== "speed") {
    throw new ApiError(400, 'stat must be "strength" or "speed"');
  }
  const pet = await petService.getPetById(req.params.id);
  petService.assertOwnership(pet, wallet);
  const result = await petService.trainPet(pet, stat);
  res.json(result);
});

export const renamePet = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const name = req.body?.name;
  if (typeof name !== "string") throw new ApiError(400, "name must be a string");
  const pet = await petService.getPetById(req.params.id);
  const updated = await petService.renamePet(pet, wallet, name);
  res.json(updated);
});

export const equipAccessory = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const itemKey = req.body?.itemKey ?? null;
  if (itemKey !== null && typeof itemKey !== "string") throw new ApiError(400, "itemKey must be a string or null");
  const pet = await petService.getPetById(req.params.id);
  const updated = await petService.equipAccessory(pet, wallet, itemKey);
  res.json(updated);
});

export const recordMint = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const { mintAddress, metadataUri } = req.body;
  if (!mintAddress || !metadataUri) throw new ApiError(400, "mintAddress and metadataUri are required");
  const pet = await petService.getPetById(req.params.id);
  const updated = await petService.recordMint(pet, wallet, mintAddress, metadataUri);
  res.json(updated);
});

// Interactive training: open a session, play the mini-game, report the score.
export const startTraining = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const game = req.body?.game;
  if (typeof game !== "string") throw new ApiError(400, "game is required");
  res.status(201).json(await trainingService.startTraining(req.params.id, wallet, game));
});

export const finishTraining = asyncHandler(async (req: Request, res: Response) => {
  const wallet = requireCaller(req);
  const score = req.body?.score;
  if (typeof score !== "number") throw new ApiError(400, "score must be a number");
  res.json(await trainingService.finishTraining(req.params.id, req.params.sessionId, wallet, score));
});
