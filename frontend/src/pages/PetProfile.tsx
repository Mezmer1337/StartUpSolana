import { useEffect, useState } from "react";
import type { FC } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { GROWTH_STAGE_LABEL, growthStageForLevel } from "../types/pet";
import type { Pet, PetTraits } from "../types/pet";
import { extractErrorMessage, petApi } from "../services/api";
import { RarityBadge } from "../components/RarityBadge";
import { StatBar } from "../components/StatBar";
import { Button } from "../components/Button";
import { PetViewer } from "../components/PetViewer";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { MintNftPanel } from "../components/MintNftPanel";
import { SellPetModal } from "../components/SellPetModal";

type ActionKey = "feed" | "play" | "rest" | "trainStrength" | "trainSpeed";

const TRAIT_LABELS: Record<keyof PetTraits, string> = {
  ears: "Ears",
  eyes: "Eyes",
  mouth: "Mouth",
  tail: "Tail",
  legs: "Legs",
  wings: "Wings",
  fins: "Fins",
  special: "Special",
  pattern: "Pattern",
};

export const PetProfile: FC = () => {
  const { id } = useParams<{ id: string }>();
  // Owner actions are only offered to the signed-in wallet.
  const { wallet: signedInWallet } = useAuth();
  const { upsertPet, refreshAll, inventory } = useGameData();
  const { showToast } = useToast();

  const [pet, setPet] = useState<Pet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [equipping, setEquipping] = useState(false);

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
      else if (key === "play") result = await petApi.play(id, wallet);
      else if (key === "rest") {
        const r = await petApi.rest(id, wallet);
        result = { pet: r.pet, leveledUp: false as const };
      } else if (key === "trainStrength") result = await petApi.train(id, wallet, "strength");
      else result = await petApi.train(id, wallet, "speed");

      setPet(result.pet);
      upsertPet(result.pet);

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

  const traits: PetTraits = JSON.parse(pet.traits);
  const growthStage = growthStageForLevel(pet.level);
  const accessories = inventory.filter((entry) => entry.item.category === "COSMETIC" && entry.quantity > 0);

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-8">
      <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 h-fit">
        <PetViewer pet={pet} size={160} />
        <h1 className="text-2xl font-bold text-white">{pet.name}</h1>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <RarityBadge rarity={pet.rarity} />
          <span className="text-xs text-gray-400 glass rounded-full px-2 py-1">{pet.archetype}</span>
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
            {(Object.keys(traits) as (keyof PetTraits)[]).map((key) => (
              <div key={key} className="flex justify-between border-b border-white/5 py-1.5">
                <span className="text-gray-400">{TRAIT_LABELS[key]}</span>
                <span className="text-gray-200 capitalize">{traits[key]?.replace(/_/g, " ")}</span>
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
              <Button onClick={() => runAction("play")} loading={busy === "play"} disabled={busy !== null}>
                🎾 Play
              </Button>
              <Button variant="secondary" onClick={() => runAction("rest")} loading={busy === "rest"} disabled={busy !== null}>
                😴 Rest
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => runAction("trainStrength")}
                  loading={busy === "trainStrength"}
                  disabled={busy !== null}
                >
                  🏋️ Train STR
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => runAction("trainSpeed")}
                  loading={busy === "trainSpeed"}
                  disabled={busy !== null}
                >
                  👟 Train SPD
                </Button>
              </div>
            </div>
          </div>
        )}

        {isOwner && (
          <div className="glass rounded-2xl p-6">
            <h2 className="font-bold text-white mb-1">Equip Accessory</h2>
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
    case "play":
      return "Played together 🎾";
    case "rest":
      return "Energy restored 😴";
    case "trainStrength":
      return "Strength increased 🏋️";
    case "trainSpeed":
      return "Speed increased 👟";
  }
}
