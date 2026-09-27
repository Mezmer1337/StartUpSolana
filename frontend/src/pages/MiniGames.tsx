import { useState } from "react";
import type { FC } from "react";
import { ReactionGame } from "../components/games/ReactionGame";
import { SignInPrompt } from "../components/AuthButton";
import { useAuth } from "../context/AuthContext";
import { MemoryGame } from "../components/games/MemoryGame";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage, gamesApi } from "../services/api";

type GameKey = "REACTION" | "MEMORY";

export const MiniGames: FC = () => {
  const { signedIn } = useAuth();
  const { wallet, pets, refreshAll } = useGameData();
  const { showToast } = useToast();
  const [activeGame, setActiveGame] = useState<GameKey>("REACTION");
  const [petId, setPetId] = useState<string>("");

  if (!signedIn) return <SignInPrompt action="play mini-games" />;

  const handleFinish = async (score: number) => {
    if (!wallet) return;
    try {
      const result = await gamesApi.complete(activeGame, wallet, score, petId || undefined);
      showToast(
        `Score ${result.score} — +${result.xpAwarded} XP, +${result.coinsAwarded} PetCoins`,
        result.score > 0 ? "success" : "info"
      );
      if (result.pet?.leveledUp) {
        showToast(`Your pet reached Level ${result.pet.pet.level}! 🎉`, "levelup");
      }
      await refreshAll();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Mini Games</h1>
      <p className="text-sm text-gray-400 mb-6">
        Play for XP and PetCoins. Only Reaction and Memory are implemented in this MVP — see README for what's next.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-2">
          {(["REACTION", "MEMORY"] as GameKey[]).map((g) => (
            <button
              key={g}
              onClick={() => setActiveGame(g)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                activeGame === g ? "border-purple-400 bg-purple-500/20 text-white" : "border-white/10 text-gray-400"
              }`}
            >
              {g === "REACTION" ? "🎯 Reaction" : "🧠 Memory"}
            </button>
          ))}
        </div>

        {pets.length > 0 && (
          <select
            value={petId}
            onChange={(e) => setPetId(e.target.value)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
          >
            <option value="" className="bg-[#12121f]">
              Account XP only
            </option>
            {pets.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#12121f]">
                Give XP to {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="glass rounded-2xl p-8 max-w-md mx-auto">
        {activeGame === "REACTION" ? (
          <ReactionGame key="reaction" onFinish={handleFinish} />
        ) : (
          <MemoryGame key="memory" onFinish={handleFinish} />
        )}
      </div>
    </div>
  );
};
