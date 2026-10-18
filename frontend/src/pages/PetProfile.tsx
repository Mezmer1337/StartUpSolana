import { useEffect, useState } from "react";
import type { FC } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { GROWTH_STAGE_LABEL, growthStageForLevel } from "../types/pet";
import type { Pet } from "../types/pet";
import { describeLook, lookFromRecord } from "../../../shared/petArt";
import type { PetMood } from "../../../shared/petArt";
import { TRAINING_GAMES } from "../../../shared/game/training";
import type { TrainingGameKey } from "../../../shared/game/training";
import { TrainingModal } from "../components/training/TrainingModal";
import { extractErrorMessage, petApi } from "../services/api";
import { RarityBadge, RarityFrame } from "../components/RarityBadge";
import { StatBar } from "../components/StatBar";
import { Button } from "../components/Button";
import { PetViewer } from "../components/PetViewer";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { MintNftPanel } from "../components/MintNftPanel";
import { SellPetModal } from "../components/SellPetModal";

type ActionKey = "feed" | "rest";

/** How the pet reacts on screen right after an action. */
const ACTION_MOOD: Record<ActionKey, PetMood> = { feed: "happy", rest: "sleep" };

export const PetProfile: FC = () => {
  const { id } = useParams<{ id: string }>();
  // Owner actions are only offered to the signed-in wallet.
  const { wallet: signedInWallet } = useAuth();
  const { upsertPet, refreshAll, inventory } = useGameData();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [pet, setPet] = useState<Pet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [equipping, setEquipping] = useState(false);
  const [training, setTraining] = useState<TrainingGameKey | null>(null);
  const [mood, setMood] = useState<PetMood | undefined>(undefined);

  // A reaction mood (happy/sleep) lasts a few seconds, then back to default.
  useEffect(() => {
    if (!mood) return;
    const t = setTimeout(() => setMood(undefined), 3500);
    return () => clearTimeout(t);
  }, [mood]);

  const wallet = signedInWallet ?? undefined;
  const isOwner = !!wallet && pet?.ownerWallet === wallet;

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await petApi.getById(id);
      setPet(p);
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runAction = async (key: ActionKey) => {
    if (!id || !wallet) return;
    setBusy(key);
    try {
      let result;
      if (key === "feed") result = await petApi.feed(id, wallet);
      else {
        const r = await petApi.rest(id, wallet);
        result = { pet: r.pet, leveledUp: false as const };
      }

      setPet(result.pet);
      upsertPet(result.pet);
      setMood(ACTION_MOOD[key]);

      if (result.leveledUp) {
        showToast(`${result.pet.name} reached Level ${result.pet.level}! 🎉`, "levelup");
      } else {
        showToast(actionSuccessLabel(key), "success");
      }
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const equip = async (itemKey: string | null) => {
    if (!id || !wallet) return;
    setEquipping(true);
    try {
      const updated = await petApi.equip(id, wallet, itemKey);
      setPet(updated);
      upsertPet(updated);
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setEquipping(false);
    }
  };

  if (loading) return <p className="text-gray-400 text-center py-20">Loading pet…</p>;
  if (!pet) return <p className="text-gray-400 text-center py-20">Pet not found.</p>;

  const traits = describeLook(lookFromRecord(pet));
  const growthStage = growthStageForLevel(pet.level);
  const accessories = inventory.filter((entry) => entry.item.category === "COSMETIC" && entry.quantity > 0);

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 sm:gap-8">
      <div className="glass rounded-3xl p-5 sm:p-8 flex flex-col items-center gap-4 h-fit">
        <RarityFrame rarity={pet.rarity}>
          <PetViewer pet={pet} size={220} mood={mood} />
        </RarityFrame>
        <h1 className="text-2xl font-bold text-white">{pet.name}</h1>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <RarityBadge rarity={pet.rarity} />
          <span className="text-xs text-gray-400 glass rounded-full px-2 py-1">
            {GROWTH_STAGE_LABEL[growthStage]}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 w-full text-center text-xs text-gray-400 mt-2">
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.level}</div>
            Level
          </div>
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.xp}</div>
            XP
          </div>
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.strength}</div>
            Strength
          </div>
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.speed}</div>
            Speed
          </div>
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.luck}</div>
            Luck
          </div>
          <div className="glass rounded-lg py-2">
            <div className="text-white font-bold text-base">{pet.traitScore}</div>
            Trait Score
          </div>
        </div>
        <div className="w-full text-xs text-gray-500 flex flex-col gap-1 mt-2">
          <div className="flex justify-between">
            <span>DNA</span>
            <span className="text-gray-300 font-mono">{pet.dnaHash.slice(0, 10)}…</span>
          </div>
          <div className="flex justify-between">
            <span>NFT ID</span>
            <span className="text-gray-300 font-mono">
              {pet.nftMintAddress ? `${pet.nftMintAddress.slice(0, 4)}…${pet.nftMintAddress.slice(-4)}` : "Not minted"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Created</span>
            <span className="text-gray-300">{new Date(pet.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-bold text-white mb-4">Stats</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <StatBar label="Health" value={pet.health} />
            <StatBar label="Hunger" value={pet.hunger} />
            <StatBar label="Happiness" value={pet.happiness} />
            <StatBar label="Energy" value={pet.energy} />
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-bold text-white mb-4">Traits</h2>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {traits.map((t) => (
              <div key={t.trait_type} className="flex justify-between border-b border-white/5 py-1.5">
                <span className="text-gray-400">{t.trait_type}</span>
                <span className="text-gray-200">{t.value}</span>
              </div>
            ))}
            {pet.auraType && (
              <div className="flex justify-between border-b border-white/5 py-1.5 sm:col-span-2">
                <span className="text-gray-400">Elemental Aura</span>
                <span className="text-amber-300 font-semibold">{pet.auraType}</span>
              </div>
            )}
          </div>
        </div>

        {isOwner && (
          <div className="glass rounded-2xl p-6">
            <h2 className="font-bold text-white mb-4">Actions</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Button onClick={() => runAction("feed")} loading={busy === "feed"} disabled={busy !== null}>
                🍖 Feed
              </Button>
              {/* Play = the mini-games, with this pet preselected — leveling through play. */}
              <Button onClick={() => navigate(`/games?pet=${pet.id}`)} disabled={busy !== null}>
                🎮 Play
              </Button>
              <Button variant="secondary" onClick={() => runAction("rest")} loading={busy === "rest"} disabled={busy !== null}>
                😴 Rest
              </Button>
            </div>
          </div>
        )}

        {isOwner && (
          <div className="glass rounded-2xl p-6">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="font-bold text-white">Training</h2>
              <span className="text-xs text-gray-400">⚡ {pet.energy} Energy</span>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Play a mini-game with {pet.name} — the better you do, the more XP and stats it gains.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {Object.values(TRAINING_GAMES)
                .filter((g) => g.category === "pet")
                .map((g) => (
                <button
                  key={g.key}
                  onClick={() => setTraining(g.key)}
                  className="glass rounded-xl p-4 text-left hover:bg-white/10 hover:-translate-y-0.5 transition-all"
                >
                  <div className="text-3xl mb-1">{g.emoji}</div>
                  <div className="font-semibold text-white text-sm">{g.name}</div>
                  <div className="text-xs text-emerald-300 capitalize">+{g.stat}</div>
                  <div className="text-[11px] text-gray-500 mt-1">−{g.energyCost} ⚡</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {isOwner && (
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="font-bold text-white">Equip Accessory</h2>
              <Link to="/shop" className="text-xs text-purple-300 hover:underline">🏪 Shop: items, horns, tails, auras →</Link>
            </div>
            <p className="text-sm text-gray-400 mb-4">Cosmetic only — doesn't affect stats.</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => equip(null)}
                disabled={equipping}
                className={`px-3 py-2 rounded-xl text-sm border ${
                  !pet.equippedAccessoryKey ? "border-purple-400 bg-purple-500/20" : "border-white/10"
                }`}
              >
                None
              </button>
              {accessories.map((entry) => (
                <button
                  key={entry.item.key}
                  onClick={() => equip(entry.item.key)}
                  disabled={equipping}
                  className={`px-3 py-2 rounded-xl text-sm border flex items-center gap-1.5 ${
                    pet.equippedAccessoryKey === entry.item.key
                      ? "border-purple-400 bg-purple-500/20"
                      : "border-white/10"
                  }`}
                >
                  <span>{entry.item.icon}</span>
                  {entry.item.name}
                </button>
              ))}
              {accessories.length === 0 && (
                <p className="text-xs text-gray-500">No accessories yet — earn them from quests and daily rewards.</p>
              )}
            </div>
          </div>
        )}

        {isOwner && (
          <div className="glass rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-bold text-white mb-1">List for Sale</h2>
              <p className="text-sm text-gray-400">Put {pet.name} on the Marketplace for other players to buy.</p>
            </div>
            <Button variant="secondary" onClick={() => setSellOpen(true)}>
              🏷 Sell
            </Button>
          </div>
        )}

        {isOwner && (
          <MintNftPanel
            pet={pet}
            onMinted={(updated) => {
              setPet(updated);
              upsertPet(updated);
            }}
          />
        )}
      </div>

      {wallet && (
        <TrainingModal
          pet={pet}
          wallet={wallet}
          game={training}
          onClose={() => setTraining(null)}
          onPetUpdated={(updated) => {
            setPet(updated);
            upsertPet(updated);
          }}
        />
      )}

      <SellPetModal
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        defaultPetId={pet.id}
        onListed={() => refreshAll()}
      />
    </div>
  );
};

function actionSuccessLabel(key: ActionKey) {
  switch (key) {
    case "feed":
      return "Fed your pet 🍖";
    case "rest":
      return "Energy restored 😴";
  }
}
