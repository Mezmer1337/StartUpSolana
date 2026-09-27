import { Router } from "express";
import * as dailyRewardController from "../controllers/dailyRewardController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();
router.get("/:wallet", dailyRewardController.getStatus);
router.post("/claim", requireSignedInWallet("walletAddress"), dailyRewardController.claim);

export default router;
