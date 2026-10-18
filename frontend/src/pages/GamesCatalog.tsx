import type { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TRAINING_GAMES, strengthPerks } from "../../../shared/game/training";
import { ARCADE } from "../games/registry";
import { highScore } from "../games/common/canvas";
import { useGameData } from "../context/GameDataContext";
import { useAuth } from "../context/AuthContext";
import { PetPortrait } from "../components/PetViewer";
import { GUEST_PET } from "../games/ui/types";


/** /games — the mini-game catalog. Arcade games train your pet's Strength. */
export const GamesCatalog: FC = () => {
  const { signedIn } = useAuth();
  const { pets } = useGameData();
  const [search] = useSearchParams();
  // Coming from a pet's "Play" button: that pet plays; otherwise the strongest one.
  const strongest = pets.find((p) => p.id === search.get("pet")) ?? [...pets].sort((a, b) => b.strength - a.strength)[0];
  const perks = strengthPerks(strongest?.strength ?? 10);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Games</h1>
          <p className="text-sm text-gray-400">
            Every arcade run with your pet trains its <b className="text-white">Strength</b> — and Strength gives extra lives and shields in the games.
          </p>
          {(!signedIn || pets.length === 0) && (
            <p className="text-sm text-amber-300 mt-2">
              🥚 You need a pet to play.{" "}
              <Link to="/pets" className="underline">
                {signedIn ? "Hatch an egg" : "Sign in and hatch an egg"}
              </Link>{" "}
              first.
            </p>
          )}
        </div>
        {signedIn && strongest && (
          <div className="glass rounded-xl px-3 py-2 flex items-center gap-2 text-xs self-start">
            <PetPortrait art={strongest} size={36} />
            <span className="text-gray-300">
              {strongest.name} · 💪 {strongest.strength}
              <br />
              <span className="text-emerald-300">{perks.label}</span>
            </span>
          </div>
        )}
      </div>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">Arcade · trains Strength</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(ARCADE).map(([slug, { key }]) => {
            const g = TRAINING_GAMES[key];
            const best = highScore.get(key);
            return (
              <Link key={slug} to={strongest ? `/games/${slug}?pet=${strongest.id}` : `/games/${slug}`} className="glass rounded-2xl p-5 flex flex-col gap-3 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-900/20 transition-all group">
                <div className="flex items-center justify-between">
                  <span className="text-4xl">{g.emoji}</span>
                  <PetPortrait art={strongest ?? GUEST_PET} size={56} mood="run" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg group-hover:text-purple-300">{g.name}</h3>
                  <p className="text-sm text-gray-400">{g.description}</p>
                </div>
                <div className="flex items-center justify-between mt-auto text-xs">
                  <span className="text-gray-500">{best ? `Best ${best}` : "No score yet"}</span>
                  <span
                    className={`px-3 py-1.5 rounded-lg font-semibold ${
                      strongest ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white" : "bg-white/10 text-gray-400"
                    }`}
                  >
                    {strongest ? "PLAY" : "🔒 Needs a pet"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">Pet training · on your pet's page</h2>
        <div className="grid grid-cols-3 gap-3">
          {Object.values(TRAINING_GAMES)
            .filter((g) => g.category === "pet")
            .map((g) => (
              <Link key={g.key} to="/pets" className="glass rounded-xl p-3 text-center hover:bg-white/10">
                <div className="text-2xl">{g.emoji}</div>
                <div className="text-xs text-white font-semibold">{g.name}</div>
                <div className="text-[11px] text-emerald-300 capitalize">+{g.stat}</div>
              </Link>
            ))}
        </div>
      </section>

    </div>
  );
};
