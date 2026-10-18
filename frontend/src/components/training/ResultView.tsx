import { useEffect, useState } from "react";
import type { FC } from "react";
import { Button } from "../Button";
import { PetPortrait } from "../PetViewer";
import { MEDAL_EMOJI } from "../../../../shared/game/training";
import type { TrainingResult } from "../../services/api";
import { GROWTH_STAGE_LABEL, growthStageForLevel } from "../../types/pet";
import type { Pet } from "../../types/pet";

export const STAT_LABEL = { strength: "Strength", speed: "Speed", luck: "Luck" } as const;

/** Medal, gains, animated XP bar and level-up celebration after a training session. */
export const ResultView: FC<{
  pet: Pet;
  result: TrainingResult;
  stat: keyof typeof STAT_LABEL;
  canAgain: boolean;
  onAgain: () => void;
  onDone: () => void;
}> = ({ pet, result, stat, canAgain, onAgain, onDone }) => {
  const { reward, progress } = result;
  const span = Math.max(1, progress.nextLevelXp - progress.levelStartXp);
  const pctAfter = Math.min(100, ((progress.xpAfter - progress.levelStartXp) / span) * 100);
  // Level-up: the bar fills from 0 in the new level; otherwise from the old XP.
  const pctBefore = result.leveledUp ? 0 : Math.max(0, ((progress.xpBefore - progress.levelStartXp) / span) * 100);
  const [fill, setFill] = useState(pctBefore);
  useEffect(() => {
    const t = setTimeout(() => setFill(pctAfter), 250);
    return () => clearTimeout(t);
  }, [pctAfter]);

  const stageBefore = growthStageForLevel(progress.levelBefore);
  const stageAfter = growthStageForLevel(progress.levelAfter);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="relative">
        {result.leveledUp && <div className="absolute inset-0 rounded-full animate-hatch-flash" />}
        <PetPortrait art={pet} size={170} mood={reward.medal === "none" ? "idle" : "happy"} />
      </div>
      <div className="text-5xl animate-level-up">{MEDAL_EMOJI[reward.medal]}</div>
      <div className="text-2xl font-bold text-white">Score {reward.score}</div>
      {result.leveledUp && (
        <div className="text-lg font-black gradient-text animate-level-up">
          LEVEL UP! {progress.levelBefore} → {progress.levelAfter}
        </div>
      )}
      {stageAfter !== stageBefore && (
        <div className="text-sm text-amber-300">
          ✨ {pet.name} grew up: {GROWTH_STAGE_LABEL[stageBefore]} → {GROWTH_STAGE_LABEL[stageAfter]}!
        </div>
      )}
      <div className="flex gap-3 text-sm flex-wrap justify-center">
        <span className="glass rounded-lg px-3 py-1 text-white">+{reward.xp} XP</span>
        {reward.statGain > 0 && (
          <span className="glass rounded-lg px-3 py-1 text-emerald-300">
            +{reward.statGain} {STAT_LABEL[stat]}
          </span>
        )}
        <span className="glass rounded-lg px-3 py-1 text-amber-300">+{reward.coins} 🪙</span>
      </div>
      <div className="w-full">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Level {progress.levelAfter}</span>
          <span>
            {progress.xpAfter - progress.levelStartXp} / {span} XP
          </span>
        </div>
        <div className="h-3 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-400 to-cyan-300 transition-[width] duration-1000 ease-out"
            style={{ width: `${fill}%` }}
          />
        </div>
      </div>
      <div className="flex gap-2 w-full mt-2">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          Done
        </Button>
        <Button className="flex-1" onClick={onAgain} disabled={!canAgain}>
          {canAgain ? "Train again" : "Too tired 😴"}
        </Button>
      </div>
    </div>
  );
};
