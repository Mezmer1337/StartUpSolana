import { Router } from "express";
import petsRouter from "./pets";
import inventoryRouter from "./inventory";
import marketplaceRouter from "./marketplace";
import leaderboardRouter from "./leaderboard";
import userRouter from "./user";
import dailyRewardRouter from "./dailyReward";
import metadataRouter from "./metadata";
import economyRouter from "./economy";
import gamesRouter from "./games";
import questsRouter from "./quests";
import authRouter from "./auth";
import { ITEM_CATALOG } from "../constants/items";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.get("/items", (_req, res) => res.json(ITEM_CATALOG));

router.use("/auth", authRouter);
router.use("/pets", petsRouter);
router.use("/inventory", inventoryRouter);
router.use("/marketplace", marketplaceRouter);
router.use("/leaderboard", leaderboardRouter);
router.use("/user", userRouter);
router.use("/daily-reward", dailyRewardRouter);
router.use("/metadata", metadataRouter);
router.use("/economy", economyRouter);
router.use("/games", gamesRouter);
router.use("/quests", questsRouter);

export default router;
