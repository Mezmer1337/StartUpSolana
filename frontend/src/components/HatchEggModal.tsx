import { useEffect, useMemo, useState } from "react";
import type { FC, FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { renderEggSvg, svgToDataUri } from "../../../shared/petArt";
import type { EggCrack } from "../../../shared/petArt";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { RarityBadge, RarityFrame } from "./RarityBadge";
import { RARITY_COLOR } from "../types/pet";
import { PetViewer } from "./PetViewer";
import type { Pet } from "../types/pet";
import { economyApi, extractErrorMessage, petApi } from "../services/api";
import type { MintPriceQuote } from "../services/api";
import { payMintPrice } from "../services/mintPayment";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";

/**
 * shop      — mystery egg + price, nothing about the pet can be chosen
 * paying    — player approves the SOL transfer in Phantom
 * incubating— backend verifies payment and rolls the DNA (egg wobbles)
 * hatching  — crack frames 1..3, then a flash
 * revealed  — the one-of-a-kind pet pops out; player may name it
 */
type Stage = "shop" | "paying" | "incubating" | "hatching" | "revealed";

const CRACK_FRAME_MS = 650;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const HatchEggModal: FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { wallet: walletAddress, upsertPet } = useGameData();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { showToast } = useToast();

  const [stage, setStage] = useState<Stage>("shop");
  const [crack, setCrack] = useState<EggCrack>(0);
  const [quote, setQuote] = useState<MintPriceQuote | null>(null);
  const [pet, setPet] = useState<Pet | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [eggSeed] = useState(() => Math.random().toString(36).slice(2));

  useEffect(() => {
    if (open) economyApi.getMintPrice().then(setQuote).catch(() => setQuote(null));
  }, [open]);

  const eggSrc = useMemo(() => svgToDataUri(renderEggSvg(eggSeed, crack)), [eggSeed, crack]);

  const handleBuy = async () => {
    if (!walletAddress || !quote) return;
    if (!quote.treasuryWallet) {
      showToast("Treasury wallet is not configured on the backend (see .env.example)", "error");
      return;
    }

    try {
      setStage("paying");
      // 1) Pay the current dynamic egg price in SOL to the treasury.
      const signature = await payMintPrice(connection, wallet, quote.treasuryWallet, quote.priceSol);

      setStage("incubating");
      // 2) Backend re-verifies the payment on-chain, rolls DNA server-side,
      // and guarantees the look is unique (visualKey) before creating it.
      const result = await petApi.mint({ ownerWallet: walletAddress, paymentTxSignature: signature });
      upsertPet(result.pet);
      setPet(result.pet);
      setName(result.pet.name);

      // 3) Hatching animation.
      setStage("hatching");
      for (const k of [1, 2, 3] as const) {
        setCrack(k);
        await sleep(CRACK_FRAME_MS);
      }
      setStage("revealed");
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
      setStage("shop");
      setCrack(0);
    }
  };

  const handleName = async (e: FormEvent) => {
    e.preventDefault();
    if (!pet || !walletAddress) return;
    if (name.trim() === pet.name) return handleClose();
    setSavingName(true);
    try {
      const updated = await petApi.rename(pet.id, walletAddress, name);
      upsertPet(updated);
      handleClose();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setSavingName(false);
    }
  };

  const busy = stage === "paying" || stage === "incubating" || stage === "hatching";

  const handleClose = () => {
    if (busy) return; // never lose a paid egg mid-hatch
    setStage("shop");
    setCrack(0);
    setPet(null);
    onClose();
  };

  if (stage === "revealed" && pet) {
    return (
      <Modal open={open} onClose={handleClose} title="It hatched!">
        <form onSubmit={handleName} className="flex flex-col items-center gap-4 py-2">
          <div className="relative">
            {/* The flash takes the rarity colour — a Mythic hatch looks nothing like a Common one. */}
            <div
              className={`absolute -inset-6 rounded-full animate-hatch-flash ${["EPIC", "LEGENDARY", "MYTHIC"].includes(pet.rarity) ? "scale-150" : ""}`}
              style={{ ["--flash" as string]: RARITY_COLOR[pet.rarity] }}
            />
            <div className="animate-level-up">
              <RarityFrame rarity={pet.rarity}>
                <PetViewer pet={pet} size={220} mood="happy" />
              </RarityFrame>
            </div>
          </div>
          {["LEGENDARY", "MYTHIC"].includes(pet.rarity) && (
            <div className={`text-xl font-black animate-level-up ${pet.rarity === "MYTHIC" ? "rarity-badge-mythic" : "rarity-badge-legendary"} px-4 py-1 rounded-full`}>
              {pet.rarity === "MYTHIC" ? "✦ MYTHIC HATCH ✦" : "★ LEGENDARY HATCH ★"}
            </div>
          )}
          <RarityBadge rarity={pet.rarity} className="text-sm" />
          {pet.auraType && <p className="text-xs text-amber-300">✨ Rolled a rare {pet.auraType} Aura!</p>}
          <p className="text-xs text-gray-400 text-center">
            No other pet in the game looks like this one — its look is checked for uniqueness at hatch time.
          </p>
          <div className="w-full">
            <label className="text-xs text-gray-400 mb-1 block">Name your pet</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={32}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-purple-400"
            />
          </div>
          <Button type="submit" loading={savingName} disabled={!name.trim()} className="w-full">
            Welcome, {name.trim() || "friend"}!
          </Button>
          <p className="text-[10px] text-gray-500 font-mono break-all text-center">DNA {pet.dnaHash}</p>
        </form>
      </Modal>
    );
  }

  const eggAnim =
    stage === "incubating" ? "animate-egg-wobble" : stage === "hatching" ? "animate-egg-shake" : "animate-egg-float";

  return (
    <Modal open={open} onClose={handleClose} title="Mystery Egg">
      <div className="flex flex-col items-center gap-4">
        <img src={eggSrc} width={200} height={200} alt="Mystery egg" draggable={false} className={eggAnim} />

        <p className="text-sm text-gray-300 text-center">
          {stage === "incubating"
            ? "Something is moving inside…"
            : stage === "hatching"
              ? "It's hatching!"
              : "What's inside? Nobody knows — not even us."}
        </p>

        <ul className="text-xs text-gray-400 flex flex-col gap-1 self-stretch">
          <li>🧬 Every body part, the colour palette and rarity are rolled from a fresh seed at hatch time.</li>
          <li>👀 Eye colours are fully random — and half of all pets have two different eyes.</li>
          <li>🦄 Horns and a tail are rare finds — rarer pets get them more often.</li>
          <li>🔒 Every hatched pet is visually unique — guaranteed by the game, not just likely.</li>
          <li>✨ Common is most likely, Mythic is a jackpot, and an Elemental Aura is extremely rare.</li>
        </ul>

        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 flex items-center justify-between text-sm self-stretch">
          <span className="text-gray-400">Egg price</span>
          <span className="font-bold text-white">{quote ? `${quote.priceSol.toFixed(3)} SOL` : "…"}</span>
        </div>
        {quote && quote.mintedLastHour > 0 && (
          <p className="text-[11px] text-gray-500 self-start">
            Price adjusts dynamically with demand — {quote.mintedLastHour} hatched in the last hour.
          </p>
        )}

        <Button onClick={handleBuy} loading={busy} disabled={!quote || busy} className="w-full">
          {stage === "paying"
            ? "Confirm payment in wallet…"
            : stage === "incubating"
              ? "Incubating…"
              : stage === "hatching"
                ? "Hatching…"
                : "🥚 Buy & Hatch"}
        </Button>
      </div>
    </Modal>
  );
};
