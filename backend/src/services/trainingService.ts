import { Pet } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";
import { MAX_STAT, xpForLevel } from "../constants/petData";
import { applyXpAndSave, assertOwnership, getPetById, logAction } from "./petService";
import { addAccountXp, awardPetCoins } from "./userService";
import { TRAINING_GAMES, trainingRewards } from "../../../shared/game/training";
import type { TrainingGameKey } from "../../../shared/game/training";

/** Anti-farming: trainings per wallet per hour (energy is the main limiter). */
const MAX_TRAININGS_PER_HOUR = 30;

function gameDef(key: string) {
  const def = TRAINING_GAMES[key as TrainingGameKey];
  if (!def) throw new ApiError(400, `Unknown training game "${key}" (expected ${Object.keys(TRAINING_GAMES).join(", ")})`);
  return def;
}

/**
 * Opens a training session. Energy is paid up front, so quitting a bad run
 * isn't free; any previous unfinished session of this pet is expired.
 */
export async function startTraining(petId: string, wallet: string, game: string) {
  const def = gameDef(game);
  const pet = await getPetById(petId);
  assertOwnership(pet, wallet);

  if (pet.energy < def.energyCost) {
    throw new ApiError(400, `${pet.name} is too tired to train (needs ${def.energyCost} Energy) — let it rest first`);
  }
  const lastHour = await prisma.trainingSession.count({
    where: { walletAddress: wallet, startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (lastHour >= MAX_TRAININGS_PER_HOUR) throw new ApiError(429, "Too many training sessions this hour — try again later");

  await prisma.trainingSession.updateMany({ where: { petId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  const [session, updatedPet] = await prisma.$transaction([
    prisma.trainingSession.create({ data: { petId, walletAddress: wallet, game: def.key } }),
    prisma.pet.update({ where: { id: petId }, data: { energy: Math.max(0, pet.energy - def.energyCost) } }),
  ]);
  return { session: { id: session.id, game: session.game, startedAt: session.startedAt }, pet: updatedPet };
}

/**
 * Closes a session and pays out. The score is the client's claim, so it is
 * checked against the session's real elapsed time: too fast, too slow,
 * above the game's max, or faster than humanly possible -> rejected.
 */
export async function finishTraining(petId: string, sessionId: string, wallet: string, rawScore: number) {
  const session = await prisma.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session || session.petId !== petId) throw new ApiError(404, "Training session not found");
  if (session.walletAddress !== wallet) throw new ApiError(403, "This is not your training session");
  if (session.status !== "ACTIVE") throw new ApiError(409, "This training session is already finished");

  const def = gameDef(session.game);
  const elapsedMs = Date.now() - session.startedAt.getTime();
  if (elapsedMs > def.maxDurationMs) {
    await prisma.trainingSession.update({ where: { id: sessionId }, data: { status: "EXPIRED" } });
    throw new ApiError(410, "Training session expired — start a new one");
  }
  if (elapsedMs < def.minDurationMs) throw new ApiError(400, "Finished impossibly fast — score rejected");
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > def.maxScore) throw new ApiError(400, "Invalid score");
  if (rawScore > (elapsedMs / 1000) * def.maxPointsPerSecond + 1) throw new ApiError(400, "Score is not plausible for the time played");

  const reward = trainingRewards(rawScore, def);
  const pet = await getPetById(petId);
  const levelBefore = pet.level;
  const xpBefore = pet.xp;

  const statData: Partial<Pet> = {
    [def.stat]: pet[def.stat] + reward.statGain,
    happiness: Math.min(MAX_STAT, pet.happiness + 5),
    lastTrainedAt: new Date(),
  };
  const result = await applyXpAndSave(pet, statData, reward.xp);

  await prisma.trainingSession.update({
    where: { id: sessionId },
    data: { status: "DONE", score: reward.score, xpAwarded: reward.xp, statGain: reward.statGain, finishedAt: new Date() },
  });
  await logAction(wallet, "TRAIN");
  await logAction(wallet, "GAME_COMPLETE"); // counts for the "Complete 2 mini-games" daily quest
  await logAction(wallet, "PLAY"); // the pet page's Play button now opens these games
  await awardPetCoins(wallet, reward.coins);
  await addAccountXp(wallet, Math.round(reward.xp / 2));

  return {
    ...result,
    reward: { ...reward, stat: def.stat },
    progress: {
      levelBefore,
      xpBefore,
      levelAfter: result.pet.level,
      xpAfter: result.pet.xp,
      levelStartXp: xpForLevel(result.pet.level),
      nextLevelXp: xpForLevel(result.pet.level + 1),
    },
  };
}
