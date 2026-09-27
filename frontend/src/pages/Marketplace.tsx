import { useEffect, useState } from "react";
import type { FC } from "react";
import { useAuth } from "../context/AuthContext";
import type { MarketplaceListing } from "../types/marketplace";
import { PET_EMOJI, PET_TYPES, RARITIES, RARITY_COLOR } from "../types/pet";
import { RarityBadge } from "../components/RarityBadge";
import { Button } from "../components/Button";
import { extractErrorMessage, marketplaceApi } from "../services/api";
import type { MarketplaceFilters } from "../services/api";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { SellPetModal } from "../components/SellPetModal";

export const Marketplace: FC = () => {
  const { signedIn, wallet } = useAuth();
  const { refreshAll } = useGameData();
  const { showToast } = useToast();

  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MarketplaceFilters>({});
  const [sellOpen, setSellOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);


  const load = async () => {
    setLoading(true);
    try {
      setListings(await marketplaceApi.list(filters));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleBuy = async (listing: MarketplaceListing) => {
    if (!wallet) return;
    setBuying(listing.id);
    try {
      await marketplaceApi.buy(wallet, listing.id);
      showToast(`Bought ${listing.pet.name} for ${listing.priceSol} SOL!`, "success");
      await load();
      await refreshAll();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setBuying(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Marketplace</h1>
        {signedIn && <Button onClick={() => setSellOpen(true)}>+ List a Pet</Button>}
      </div>

      <div className="glass rounded-2xl p-4 mb-6 grid sm:grid-cols-4 gap-3">
        <select
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
          value={filters.type ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
        >
          <option value="" className="bg-[#12121f]">
            All species
          </option>
          {PET_TYPES.map((t) => (
            <option key={t} value={t} className="bg-[#12121f]">
              {t}
            </option>
          ))}
        </select>

        <select
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
          value={filters.rarity ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, rarity: e.target.value || undefined }))}
        >
          <option value="" className="bg-[#12121f]">
            All rarities
          </option>
          {RARITIES.map((r) => (
            <option key={r} value={r} className="bg-[#12121f]">
              {r}
            </option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Max price (SOL)"
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          value={filters.maxPrice ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value ? Number(e.target.value) : undefined }))}
        />

        <input
          type="number"
          placeholder="Min level"
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          value={filters.minLevel ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, minLevel: e.target.value ? Number(e.target.value) : undefined }))}
        />
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading listings…</p>}
      {!loading && listings.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center text-gray-400">No pets listed right now.</div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {listings.map((listing) => (
          <div key={listing.id} className="glass rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center text-4xl"
                style={{ background: `${RARITY_COLOR[listing.pet.rarity]}18` }}
              >
                {PET_EMOJI[listing.pet.type]}
              </div>
              <RarityBadge rarity={listing.pet.rarity} />
            </div>
            <div>
              <h3 className="font-bold text-white">{listing.pet.name}</h3>
              <p className="text-xs text-gray-400">
                {listing.pet.type} · Level {listing.pet.level}
              </p>
            </div>
            <p className="text-xs text-gray-500 font-mono truncate">
              Seller: {listing.sellerWallet.slice(0, 4)}…{listing.sellerWallet.slice(-4)}
            </p>
            <div className="flex items-center justify-between mt-auto pt-2">
              <div>
                <span className="text-lg font-bold gradient-text">{listing.priceSol} SOL</span>
                <p className="text-[10px] text-gray-500">5% platform + royalty fee applies</p>
              </div>
              <Button
                onClick={() => handleBuy(listing)}
                loading={buying === listing.id}
                disabled={!signedIn || wallet === listing.sellerWallet}
                title={signedIn ? undefined : "Sign in with Phantom to buy"}
              >
                Buy
              </Button>
            </div>
          </div>
        ))}
      </div>

      <SellPetModal
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        onListed={() => {
          load();
          refreshAll();
        }}
      />
    </div>
  );
};
