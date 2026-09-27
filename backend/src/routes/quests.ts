import { Router } from "express";
import * as questController from "../controllers/questController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();
router.get("/", questController.listQuests);
router.post("/:id/complete", requireSignedInWallet("wallet"), questController.completeQuestHandler);

export default router;
