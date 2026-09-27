import { useEffect, useState } from "react";
import type { FC } from "react";
import { useAuth } from "../context/AuthContext";
import { useGameData } from "../context/GameDataContext";
import { SignInPrompt } from "../components/AuthButton";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { Button } from "../components/Button";
import { useToast } from "../context/ToastContext";
import { dailyRewardApi, extractErrorMessage } from "../services/api";
import { PET_EMOJI } from "../types/pet";
import { Link } from "react-router-dom";

export const Profile: FC = () => {
  const { wallet } = useAuth();
  const { user, pets, inventory, refreshAll } = useGameData();
  const balance = useWalletBalance();
  const { showToast } = useToast();

  const [rewardStatus, setRewardStatus] = useState<{ canClaim: boolean; nextAvailableAt: string | null } | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (wallet) dailyRewardApi.status(wallet).then(setRewardStatus);
  }, [wallet, user]);

  if (!wallet) return <SignInPrompt action="view your profile" />;

  const claimReward = async () => {
    setClaiming(true);
    try {
      const result = await dailyRewardApi.claim(wallet);
      showToast(`Daily reward claimed! You received an item: ${result.itemKey}`, "success");
      await refreshAll();
      setRewardStatus(await dailyRewardApi.status(wallet));
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setClaiming(false);
    }
  };

  const nftCount = pets.filter((p) => p.mintStatus === "MINTED").length;

  return (
    <div className="flex flex-col gap-8">
      <div className="glass rounded-2xl p-6 flex flex-wrap items-center justify-between gap-6">
        <div>
          <p className="text-xs text-gray-400">Wallet Address</p>
          <p className="font-mono text-sm text-white break-all">{wallet}</p>
        </div>
        <div className="flex gap-6 text-center">
          <Stat label="SOL Balance" value={balance !== null ? balance.toFixed(3) : "…"} />
          <Stat label="Pets" value={pets.length} />
          <Stat label="NFTs" value={nftCount} />
          <Stat label="Account Lvl" value={user?.accountLevel ?? 1} />
          <Stat label="PetCoins" value={user?.petCoins ?? 0} />
        </div>
      </div>

      <div className="glass rounded-2xl p-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-bold text-white mb-1">Daily Reward</h2>
          <p className="text-sm text-gray-400">
            {rewardStatus?.canClaim
              ? "Your daily reward is ready to claim!"
              : rewardStatus?.nextAvailableAt
              ? `Next reward available ${new Date(rewardStatus.nextAvailableAt).toLocaleString()}`
              : "Checking status…"}
          </p>
        </div>
        <Button onClick={claimReward} loading={claiming} disabled={!rewardStatus?.canClaim}>
          🎁 Claim Reward
        </Button>
      </div>

      <div>
        <h2 className="font-bold text-white mb-4">Pets ({pets.length})</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pets.map((pet) => (
            <Link key={pet.id} to={`/pets/${pet.id}`} className="glass rounded-xl p-4 flex items-center gap-3 hover:bg-white/10">
              <span className="text-3xl">{PET_EMOJI[pet.type]}</span>
              <div>
                <p className="text-sm font-medium text-white">{pet.name}</p>
                <p className="text-xs text-gray-400">Lv. {pet.level}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-bold text-white mb-4">Inventory ({inventory.length})</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {inventory.map((entry) => (
            <div key={entry.id} className="glass rounded-xl p-4 flex items-center gap-3">
              <span className="text-3xl">{entry.item.icon}</span>
              <div>
                <p className="text-sm font-medium text-white">{entry.item.name}</p>
                <p className="text-xs text-gray-400">x{entry.quantity}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[11px] text-gray-400">{label}</p>
    </div>
  );
}
