import { Router } from "express";
import * as marketplaceController from "../controllers/marketplaceController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();

router.get("/", marketplaceController.getListings);
router.post("/list", requireSignedInWallet("sellerWallet"), marketplaceController.createListing);
router.post("/:id/cancel", requireSignedInWallet("sellerWallet"), marketplaceController.cancelListing);
router.post("/buy", requireSignedInWallet("buyerWallet"), marketplaceController.buyListing);

export default router;
