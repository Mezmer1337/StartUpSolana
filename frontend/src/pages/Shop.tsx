import { useEffect, useState } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../context/AuthContext";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { Button } from "../components/Button";
import { RarityBadge, RarityFrame } from "../components/RarityBadge";
import { SignInPrompt } from "../components/AuthButton";
import { extractErrorMessage, shopApi } from "../services/api";
import type { ShopItem } from "../services/api";
import { payForListing, refreshWalletBalance } from "../services/marketplacePayment";

const SECTIONS: { title: string; note?: string; filter: (i: ShopItem) => boolean }[] = [
  {
    title: "✨ Mystic · SOL only",
    note: "Change how your pet looks: new horns, a tail or an elemental aura. Its look stays one-of-a-kind.",
    filter: (i) => i.category === "MYSTIC",
  },
  { title: "💪 Training", filter: (i) => i.category === "TRAINING" },
  { title: "🍖 Care", filter: (i) => ["FOOD", "TOY", "POTION"].includes(i.category) },
  { title: "🎩 Cosmetics", note: "Equip them on your pet's page.", filter: (i) => i.category === "COSMETIC" },
];

/** /shop — buy items for PetCoins (earned in games & quests) or SOL (paid on-chain to the treasury). */
export const Shop: FC = () => {
  const { signedIn } = useAuth();
  const { wallet, user, refreshAll, refreshInventory } = useGameData();
  const walletAdapter = useWallet();
  const { connection } = useConnection();
  const { showToast } = useToast();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [treasury, setTreasury] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    shopApi
      .get()
      .then((s) => {
        setItems(s.items);
        setTreasury(s.treasuryWallet);
      })
      .catch((err) => showToast(extractErrorMessage(err), "error"));
  }, [showToast]);

  if (!signedIn) return <SignInPrompt action="shop for your pet" />;

  const buy = async (item: ShopItem, currency: "PETCOIN" | "SOL") => {
    if (!wallet) return;
    setBusy(`${item.key}:${currency}`);
    try {
      let signature: string | undefined;
      if (currency === "SOL") {
        if (!treasury || item.price.sol == null) return;
        showToast(`Approve ${item.price.sol} SOL in Phantom`, "info");
        signature = await payForListing(connection, walletAdapter, [
          { to: treasury, lamports: Math.round(item.price.sol * 1e9), label: "shop" },
        ]);
        refreshWalletBalance();
      }
      await shopApi.buy(wallet, item.key, 1, currency, signature);
      showToast(`${item.icon} ${item.name} added to your inventory`, "success");
      await Promise.all([refreshAll(), refreshInventory()]);
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Shop</h1>
          <p className="text-sm text-gray-400">
            Items level up your pet. Use them from your <Link to="/inventory" className="text-purple-300 underline">Inventory</Link>.
          </p>
        </div>
        <span className="glass rounded-full px-4 py-2 text-sm text-amber-300 font-semibold">🪙 {user?.petCoins ?? 0} PetCoins</span>
      </div>

      {SECTIONS.map((section) => {
        const list = items.filter(section.filter);
        if (!list.length) return null;
        const mystic = section.title.includes("Mystic");
        return (
          <section key={section.title}>
            <h2 className={`font-bold mb-1 ${mystic ? "rarity-badge-legendary inline-block px-3 py-1 rounded-full" : "text-white"}`}>{section.title}</h2>
            {section.note && <p className="text-xs text-gray-400 mb-3 mt-1">{section.note}</p>}
            <div className={`grid sm:grid-cols-2 lg:grid-cols-3 gap-4 ${section.note ? "" : "mt-3"}`}>
              {list.map((item) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between">
                      <span className="text-4xl">{item.icon}</span>
                      <RarityBadge rarity={item.rarity} stars={false} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{item.name}</h3>
                      <p className="text-xs text-gray-400 mt-1">{item.description}</p>
                    </div>
                    <div className="flex gap-2 mt-auto pt-1">
                      {item.price.petCoins != null && (
                        <Button
                          variant="secondary"
                          className="flex-1 !text-xs"
                          loading={busy === `${item.key}:PETCOIN`}
                          disabled={busy !== null || (user?.petCoins ?? 0) < item.price.petCoins}
                          onClick={() => buy(item, "PETCOIN")}
                        >
                          🪙 {item.price.petCoins}
                        </Button>
                      )}
                      {item.price.sol != null && (
                        <Button className="flex-1 !text-xs" loading={busy === `${item.key}:SOL`} disabled={busy !== null} onClick={() => buy(item, "SOL")}>
                          ◎ {item.price.sol} SOL
                        </Button>
                      )}
                    </div>
                  </>
                );
                return mystic ? (
                  <RarityFrame key={item.key} rarity="LEGENDARY" rounded="rounded-2xl">
                    <div className="p-5 flex flex-col gap-3 h-full">{body}</div>
                  </RarityFrame>
                ) : (
                  <div key={item.key} className="glass rounded-2xl p-5 flex flex-col gap-3">
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
