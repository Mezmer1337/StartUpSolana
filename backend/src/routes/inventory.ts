import { Router } from "express";
import * as inventoryController from "../controllers/inventoryController";
import { requireSignedInWallet } from "../middleware/auth";

const router = Router();

router.get("/:wallet", inventoryController.getInventory);
router.post("/use", requireSignedInWallet("ownerWallet"), inventoryController.useItem);

export default router;
