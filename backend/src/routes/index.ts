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
import shopRouter from "./shop";
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
router.use("/shop", shopRouter);

// Frontend crash reports (components/ErrorBoundary.tsx) land in the server
// log — on Railway: `railway logs` — so a blank-screen bug can be diagnosed.
router.post("/client-errors", (req, res) => {
  const { message, stack, url, component } = req.body ?? {};
  console.error("[client-error]", JSON.stringify({ message: String(message ?? "").slice(0, 500), url: String(url ?? "").slice(0, 300), component: String(component ?? "").slice(0, 1500), stack: String(stack ?? "").slice(0, 2000) }));
  res.status(204).end();
});

export default router;
