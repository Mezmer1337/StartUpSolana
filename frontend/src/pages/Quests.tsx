import { useEffect, useState } from "react";
import type { FC } from "react";
import { useAuth } from "../context/AuthContext";
import { useGameData } from "../context/GameDataContext";
import { SignInPrompt } from "../components/AuthButton";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/Button";
import { extractErrorMessage, questsApi } from "../services/api";
import type { QuestEntry } from "../services/api";

const TYPE_LABEL: Record<QuestEntry["type"], string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  ACHIEVEMENT: "Achievement",
};

export const Quests: FC = () => {
  const { signedIn } = useAuth();
  const { wallet, refreshAll } = useGameData();
  const { showToast } = useToast();
  const [quests, setQuests] = useState<QuestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      setQuests(await questsApi.list(wallet));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  if (!signedIn) return <SignInPrompt action="view quests" />;

  const claim = async (quest: QuestEntry) => {
    if (!wallet) return;
    setClaiming(quest.key);
    try {
      await questsApi.complete(quest.key, wallet);
      showToast(`Claimed "${quest.name}" — +${quest.reward.xp} XP, +${quest.reward.petCoins} PetCoins`, "success");
      await load();
      await refreshAll();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quests</h1>
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      <div className="flex flex-col gap-3">
        {quests.map((quest) => (
          <div key={quest.key} className="glass rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wide text-purple-300 bg-purple-500/15 border border-purple-400/30 rounded-full px-2 py-0.5">
                  {TYPE_LABEL[quest.type]}
                </span>
                {quest.claimed && <span className="text-[10px] text-emerald-300">✓ Claimed</span>}
              </div>
              <h3 className="font-semibold text-white">{quest.name}</h3>
              <p className="text-xs text-gray-400">{quest.description}</p>
              <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-purple-400 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (quest.progress / quest.target) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {quest.progress}/{quest.target} · +{quest.reward.xp} XP, +{quest.reward.petCoins} PetCoins
                {quest.reward.itemKey ? ", +item" : ""}
              </p>
            </div>
            <Button
              onClick={() => claim(quest)}
              loading={claiming === quest.key}
              disabled={!quest.canClaim}
              variant={quest.canClaim ? "primary" : "secondary"}
            >
              {quest.claimed ? "Claimed" : "Claim"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
