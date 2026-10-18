import { useEffect, useState } from "react";
import type { FC } from "react";
import { Modal } from "../Modal";
import { Button } from "../Button";
import { PetPortrait } from "../PetViewer";
import { PowerGame } from "./PowerGame";
import { HopGame } from "./HopGame";
import { CatchGame } from "./CatchGame";
import type { TrainingGameProps } from "./useGameLoop";
import { MEDAL_EMOJI, TRAINING_GAMES, trainingRewards } from "../../../../shared/game/training";
import { ResultView, STAT_LABEL } from "./ResultView";
import type { TrainingGameKey } from "../../../../shared/game/training";
import { extractErrorMessage, petApi } from "../../services/api";
import type { TrainingResult } from "../../services/api";
import type { Pet } from "../../types/pet";
import { useToast } from "../../context/ToastContext";

const GAMES: Partial<Record<TrainingGameKey, FC<TrainingGameProps>>> = { POWER: PowerGame, HOP: HopGame, CATCH: CatchGame };

type Stage = "intro" | "starting" | "countdown" | "playing" | "submitting" | "result";

export const TrainingModal: FC<{
  pet: Pet;
  wallet: string;
  game: TrainingGameKey | null;
  onClose: () => void;
  onPetUpdated: (pet: Pet) => void;
}> = ({ pet, wallet, game, onClose, onPetUpdated }) => {
  const { showToast } = useToast();
  const [stage, setStage] = useState<Stage>("intro");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [round, setRound] = useState(0); // remounts the game on "play again"

  const def = game ? TRAINING_GAMES[game] : null;

  // 3-2-1 countdown, then the game.
  useEffect(() => {
    if (stage !== "countdown") return;
    if (count === 0) {
      setStage("playing");
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [stage, count]);

  const Game = game ? GAMES[game] : undefined;
  if (!game || !def || !Game) return null;

  const start = async () => {
    setStage("starting");
    try {
      const { session, pet: updated } = await petApi.startTraining(pet.id, wallet, game);
      onPetUpdated(updated);
      setSessionId(session.id);
      setResult(null);
      setCount(3);
      setRound((r) => r + 1);
      setStage("countdown");
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
      setStage("intro");
    }
  };

  const finish = async (score: number) => {
    if (!sessionId) return;
    setStage("submitting");
    try {
      const res = await petApi.finishTraining(pet.id, sessionId, wallet, score);
      onPetUpdated(res.pet);
      setResult(res);
      setStage("result");
      if (res.leveledUp) showToast(`${res.pet.name} reached Level ${res.pet.level}! 🎉`, "levelup");
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
      setStage("intro");
    }
  };

  const close = () => {
    if (stage === "playing" || stage === "submitting" || stage === "starting") return; // don't lose a paid run
    setStage("intro");
    onClose();
  };

  return (
    <Modal open onClose={close} title={`${def.emoji} ${def.name}`} wide>
      {stage === "intro" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <PetPortrait art={pet} size={150} mood={pet.energy < def.energyCost ? "sleep" : "idle"} />
          <p className="text-sm text-gray-300">{def.description}</p>
          <div className="grid grid-cols-4 gap-2 w-full text-xs">
            {(["gold", "silver", "bronze", "none"] as const).map((m) => {
              const score = { gold: 80, silver: 50, bronze: 20, none: 0 }[m];
              const r = trainingRewards(score, def);
              return (
                <div key={m} className="glass rounded-lg p-2">
                  <div className="text-xl">{MEDAL_EMOJI[m]}</div>
                  <div className="text-gray-400">{m === "none" ? "< 20" : `${score}+`}</div>
                  <div className="text-white">+{r.xp} XP</div>
                  <div className="text-emerald-300">{r.statGain ? `+${r.statGain} ${STAT_LABEL[def.stat]}` : "—"}</div>
                </div>
              );
            })}
          </div>
          <Button onClick={start} disabled={pet.energy < def.energyCost} className="w-full py-3">
            {pet.energy < def.energyCost ? `Too tired — needs ${def.energyCost} ⚡ (has ${pet.energy})` : `Start · −${def.energyCost} ⚡ Energy`}
          </Button>
        </div>
      )}

      {stage === "starting" && <p className="text-center text-gray-400 py-16">Warming up…</p>}

      {stage === "countdown" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <PetPortrait art={pet} size={150} mood="happy" />
          <div key={count} className="text-6xl font-black gradient-text animate-level-up">
            {count}
          </div>
        </div>
      )}

      {stage === "playing" && <Game key={round} pet={pet} onFinish={finish} />}

      {stage === "submitting" && <p className="text-center text-gray-400 py-16">Counting your gains…</p>}

      {stage === "result" && result && <ResultView pet={result.pet} result={result} stat={def.stat} onAgain={start} onDone={close} canAgain={result.pet.energy >= def.energyCost} />}
    </Modal>
  );
};
