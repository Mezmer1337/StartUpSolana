import { Router } from "express";
import * as petController from "../controllers/petController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();
const asOwner = requireSignedInWallet("ownerWallet");

// POST /api/pets/mint — pays SOL + generates DNA + creates the pet (see petService.mintPet).
router.post("/mint", asOwner, petController.mintPet);
router.get("/:id", petController.getPet);
router.post("/:id/feed", asOwner, petController.feedPet);
router.post("/:id/play", asOwner, petController.playWithPet);
router.post("/:id/rest", asOwner, petController.restPet);
router.post("/:id/train", asOwner, petController.trainPet);
router.post("/:id/equip", asOwner, petController.equipAccessory);
// POST /api/pets/:id/mint — records the *separate* on-chain Metaplex NFT mint for an existing pet.
router.post("/:id/mint", asOwner, petController.recordMint);
router.get("/wallet/:wallet", petController.getPetsForWallet);

export default router;
