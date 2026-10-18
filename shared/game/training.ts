// Training mini-games: the interactive way to level a pet. Shared by the
// backend (validation + rewards) and frontend (rules + reward preview), so
// both always agree on limits and payouts.

export type TrainingGameKey = "POWER" | "HOP" | "CATCH" | "SNAKE" | "CATCHER" | "RUNNER";
export type TrainableStat = "strength" | "speed" | "luck";
export type Medal = "gold" | "silver" | "bronze" | "none";

export interface TrainingGameDef {
  key: TrainingGameKey;
  /** "pet" = quick training on the pet page; "arcade" = endless games in the /games catalog. */
  category: "pet" | "arcade";
  name: string;
  emoji: string;
  stat: TrainableStat;
  description: string;
  energyCost: number;
  /** Highest raw score the server accepts. */
  maxScore: number;
  /** Raw score that counts as a perfect (100%) run for medals/rewards. Arcade games score in the hundreds. */
  fullMarks: number;
  /** A finish sooner than this after start is rejected (bots / replayed requests). */
  minDurationMs: number;
  /** A session left open longer than this expires (energy is not refunded). */
  maxDurationMs: number;
  /** Plausibility cap: score can't grow faster than this per second of play. */
  maxPointsPerSecond: number;
}

export const TRAINING_GAMES: Record<TrainingGameKey, TrainingGameDef> = {
  POWER: {
    key: "POWER",
    category: "pet",
    name: "Power Punch",
    emoji: "🥊",
    stat: "strength",
    description: "Stop the swinging needle inside the green zone. 8 punches — the zone shrinks and the needle speeds up.",
    energyCost: 15,
    maxScore: 100,
    fullMarks: 100,
    minDurationMs: 6_000,
    maxDurationMs: 5 * 60_000,
    maxPointsPerSecond: 13,
  },
  HOP: {
    key: "HOP",
    category: "pet",
    name: "Hop Run",
    emoji: "🏃",
    stat: "speed",
    description: "Jump over the rocks for 30 seconds. Three bumps and you're out.",
    energyCost: 15,
    maxScore: 100,
    fullMarks: 100,
    minDurationMs: 3_000,
    maxDurationMs: 5 * 60_000,
    maxPointsPerSecond: 8,
  },
  CATCH: {
    key: "CATCH",
    category: "pet",
    name: "Lucky Catch",
    emoji: "🍀",
    stat: "luck",
    description: "Catch falling snacks for 30 seconds. Clovers are worth extra — dodge the rocks!",
    energyCost: 15,
    maxScore: 100,
    fullMarks: 100,
    minDurationMs: 28_000,
    maxDurationMs: 5 * 60_000,
    maxPointsPerSecond: 10,
  },
  // ---- Arcade: endless games with a high score; all build Strength. ----
  SNAKE: {
    key: "SNAKE",
    category: "arcade",
    name: "Solana Snake",
    emoji: "🐍",
    stat: "strength",
    description: "Classic snake: eat SOL coins, grow longer, don't hit the walls or yourself. It speeds up as you grow.",
    energyCost: 15,
    maxScore: 5000,
    fullMarks: 400,
    minDurationMs: 2_000,
    maxDurationMs: 20 * 60_000,
    maxPointsPerSecond: 25,
  },
  CATCHER: {
    key: "CATCHER",
    category: "arcade",
    name: "Sol Catcher",
    emoji: "🪙",
    stat: "strength",
    description: "Catch falling coins on your pet's platform: coin +10, rare SOL +50. Bombs cost a life.",
    energyCost: 15,
    maxScore: 10000,
    fullMarks: 800,
    minDurationMs: 2_000,
    maxDurationMs: 20 * 60_000,
    maxPointsPerSecond: 90,
  },
  RUNNER: {
    key: "RUNNER",
    category: "arcade",
    name: "Block Runner",
    emoji: "🧱",
    stat: "strength",
    description: "Your pet runs down three lanes — dodge the incoming blocks, grab SOL coins. One hit ends the run.",
    energyCost: 15,
    maxScore: 10000,
    fullMarks: 600,
    minDurationMs: 2_000,
    maxDurationMs: 20 * 60_000,
    maxPointsPerSecond: 60,
  },
};

/**
 * Strength pays off inside the arcade games, so levelling it up is felt:
 * extra lives in Sol Catcher, shields in Block Runner and Snake.
 */
export function strengthPerks(strength: number) {
  const tier = Math.max(0, Math.min(3, Math.floor((strength - 10) / 15))); // 10 → 0, 25 → 1, 40 → 2, 55+ → 3
  return {
    tier,
    extraLives: Math.min(2, tier), // Sol Catcher: 3 base lives
    shields: tier, // Block Runner: absorbs a block; Snake: survives a crash
    label: tier === 0 ? "No bonus yet — train Strength to 25" : `+${Math.min(2, tier)} life · ${tier} shield${tier > 1 ? "s" : ""}`,
  };
}

export const GAME_DURATION_MS = 30_000;

export function medalFor(score: number, maxScore: number): Medal {
  const pct = score / maxScore;
  if (pct >= 0.8) return "gold";
  if (pct >= 0.5) return "silver";
  if (pct >= 0.2) return "bronze";
  return "none";
}

export const MEDAL_EMOJI: Record<Medal, string> = { gold: "🥇", silver: "🥈", bronze: "🥉", none: "💪" };

/** XP, stat points and PetCoins for a finished session. Effort always earns some XP. */
export function trainingRewards(score: number, def: TrainingGameDef) {
  const s = Math.max(0, Math.min(def.maxScore, Math.round(score)));
  const pct = Math.min(100, (s / def.fullMarks) * 100); // performance 0..100
  const medal = medalFor(pct, 100);
  return {
    score: s,
    medal,
    xp: 10 + Math.round(pct * 0.4),
    statGain: { gold: 3, silver: 2, bronze: 1, none: 0 }[medal],
    coins: Math.round(pct * 0.2),
  };
}
