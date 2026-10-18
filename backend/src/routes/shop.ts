import { Router } from "express";
import { asyncHandler, ApiError } from "../middleware/errorHandler";
import { isValidWalletAddress } from "../middleware/validateWallet";
import { requireSignedInWallet } from "../middleware/auth";
import { buyItem, getShop } from "../services/shopService";

const router = Router();

router.get("/", (_req, res) => res.json(getShop()));

// POST /api/shop/buy { wallet, itemKey, quantity, currency: "PETCOIN" | "SOL", txSignature? }
router.post(
  "/buy",
  requireSignedInWallet("wallet"),
  asyncHandler(async (req, res) => {
    const { wallet, itemKey, quantity = 1, currency, txSignature } = req.body ?? {};
    if (!isValidWalletAddress(wallet)) throw new ApiError(400, "Invalid wallet");
    if (typeof itemKey !== "string") throw new ApiError(400, "itemKey is required");
    res.json(await buyItem(wallet, itemKey, Number(quantity), currency, txSignature));
  })
);

export default router;
