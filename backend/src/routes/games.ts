import { Router } from "express";
import * as gameController from "../controllers/gameController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();
router.get("/", gameController.listGames);
router.post("/:id/complete", requireSignedInWallet("wallet"), gameController.completeGameHandler);

export default router;
