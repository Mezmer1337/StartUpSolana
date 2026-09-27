import { useState } from "react";
import type { FC } from "react";
import { useAuth } from "../context/AuthContext";
import { useGameData } from "../context/GameDataContext";
import { SignInPrompt } from "../components/AuthButton";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/Button";
import { extractErrorMessage, inventoryApi } from "../services/api";
import { RarityBadge } from "../components/RarityBadge";

export const Inventory: FC = () => {
  const { signedIn } = useAuth();
  const { wallet, pets, inventory, refreshInventory, upsertPet } = useGameData();
  const { showToast } = useToast();
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [using, setUsing] = useState(false);

  if (!signedIn) return <SignInPrompt action="view your inventory" />;

  const useOnPet = async (petId: string) => {
    if (!wallet || !selectedItem) return;
    setUsing(true);
    try {
      const pet = await inventoryApi.use(wallet, petId, selectedItem);
      upsertPet(pet);
      await refreshInventory();
      showToast(`Used item on ${pet.name}`, "success");
      setSelectedItem(null);
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setUsing(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Inventory</h1>

      {inventory.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center text-gray-400">
          Your inventory is empty. Claim your Daily Reward from the Profile page to get items!
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {inventory.map((entry) => (
          <div key={entry.id} className="glass rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="text-4xl">{entry.item.icon}</div>
              <RarityBadge rarity={entry.item.rarity} />
            </div>
            <div>
              <h3 className="font-semibold text-white">{entry.item.name}</h3>
              <p className="text-xs text-gray-400 mt-1">{entry.item.description}</p>
            </div>
            <div className="flex items-center justify-between mt-auto pt-2">
              <span className="text-xs text-gray-500">Qty: {entry.quantity}</span>
              <Button variant="secondary" onClick={() => setSelectedItem(entry.item.key)} className="!py-1.5 !px-3 !text-xs">
                Use
              </Button>
            </div>
          </div>
        ))}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelectedItem(null)} />
          <div className="relative glass rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-white mb-4">Use on which pet?</h3>
            {pets.length === 0 && <p className="text-sm text-gray-400">You have no pets yet.</p>}
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {pets.map((pet) => (
                <button
                  key={pet.id}
                  onClick={() => useOnPet(pet.id)}
                  disabled={using}
                  className="flex items-center justify-between rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2 text-sm text-left disabled:opacity-40"
                >
                  <span>{pet.name}</span>
                  <span className="text-xs text-gray-400">Lv. {pet.level}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
