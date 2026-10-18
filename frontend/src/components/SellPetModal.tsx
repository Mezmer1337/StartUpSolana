import { useEffect, useState } from "react";
import type { FC, FormEvent } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage, marketplaceApi } from "../services/api";
import { PetViewer } from "./PetViewer";

interface SellPetModalProps {
  open: boolean;
  onClose: () => void;
  onListed: () => void;
  /** Pre-selects a pet (e.g. opened from that pet's own profile page). */
  defaultPetId?: string;
}

export const SellPetModal: FC<SellPetModalProps> = ({ open, onClose, onListed, defaultPetId }) => {
  const { wallet, pets } = useGameData();
  const { showToast } = useToast();
  const [petId, setPetId] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPetId(defaultPetId ?? "");
  }, [open, defaultPetId]);

  // MVP: both minted and unminted pets can be listed (see README "MVP / mock" section).
  const sellablePets = pets;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet || !petId || !price) return;
    setSubmitting(true);
    try {
      await marketplaceApi.create(wallet, petId, Number(price));
      showToast("Pet listed on the marketplace!", "success");
      setPetId("");
      setPrice("");
      onListed();
      onClose();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="List a Pet for Sale">
      {sellablePets.length === 0 ? (
        <p className="text-sm text-gray-400">You need a pet before you can list one.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-2 block">Pet</label>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {sellablePets.map((pet) => (
                <button
                  type="button"
                  key={pet.id}
                  onClick={() => setPetId(pet.id)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left border transition-all ${
                    petId === pet.id ? "border-purple-400 bg-purple-500/20" : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <PetViewer pet={pet} size={40} />
                  <span className="text-sm text-white">
                    {pet.name} <span className="text-gray-500">· Lv.{pet.level}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Price (SOL)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-purple-400"
            />
          </div>

          <Button type="submit" loading={submitting} disabled={!petId || !price}>
            List for Sale
          </Button>
        </form>
      )}
    </Modal>
  );
};
