import { useEffect, useState } from "react";
import type { FC } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { LeaderboardEntry } from "../types/user";
import { leaderboardApi } from "../services/api";
import type { Rarity } from "../types/pet";
import { PetPortrait } from "../components/PetViewer";
import { RarityBadge } from "../components/RarityBadge";

export const Leaderboard: FC = () => {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    leaderboardApi
      .get()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const wallet = publicKey?.toBase58();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Leaderboard</h1>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase border-b border-white/10">
                <th className="px-2 sm:px-4 py-3 w-10">#</th>
                <th className="px-2 sm:px-4 py-3">Pet</th>
                <th className="hidden sm:table-cell px-4 py-3">Wallet</th>
                <th className="px-2 sm:px-4 py-3">Lv</th>
                <th className="px-2 sm:px-4 py-3">XP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.petId}
                  className={`border-b border-white/5 last:border-0 ${
                    entry.wallet === wallet ? "bg-purple-500/10" : ""
                  }`}
                >
                  <td className="px-2 sm:px-4 py-3 font-bold text-gray-300">
                    {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <PetPortrait art={entry.art} size={36} />
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 min-w-0">
                        <span className="text-white font-medium truncate">{entry.petName}</span>
                        <RarityBadge rarity={entry.rarity as Rarity} className="!text-[10px] !px-1.5 !py-0.5 self-start" />
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-400">
                    {entry.wallet.slice(0, 4)}…{entry.wallet.slice(-4)}
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-gray-200">{entry.level}</td>
                  <td className="px-2 sm:px-4 py-3 text-gray-200">{entry.xp}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="text-gray-400 text-sm text-center py-10">No pets yet — be the first!</p>}
        </div>
      )}
    </div>
  );
};
