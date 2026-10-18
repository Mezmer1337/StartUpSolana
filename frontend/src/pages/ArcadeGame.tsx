import { useCallback, useMemo, useState } from "react";
import type { FC } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { SignInPrompt } from "../components/AuthButton";
import { Button } from "../components/Button";
import { PetPortrait } from "../components/PetViewer";
import { ResultView } from "../components/training/ResultView";
import { ARCADE } from "../games/registry";
import { highScore } from "../games/common/canvas";
import type { Hud } from "../games/ui/types";
import { TRAINING_GAMES, strengthPerks } from "../../../shared/game/training";
import { useAuth } from "../context/AuthContext";
import { useGameData } from "../context/GameDataContext";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage, petApi } from "../services/api";
import type { TrainingResult } from "../services/api";

type Phase = "ready" | "starting" | "playing" | "submitting" | "over";

/**
 * /games/:slug — one arcade game. With a pet selected (and signed in) a run
 * is a server-validated Strength training session: it costs Energy and pays
 * XP + Strength by score. Games need a pet: signed-out players and players
 * without a pet are sent to sign in / hatch an egg first.
 */
export const ArcadeGame: FC = () => {
  const { slug = "" } = useParams();
  const [search] = useSearchParams();
  const entry = ARCADE[slug];
  const def = entry ? TRAINING_GAMES[entry.key] : null;

  const { signedIn, wallet } = useAuth();
  const { pets, upsertPet } = useGameData();
  const { showToast } = useToast();

  const [petId, setPetId] = useState<string>(() => search.get("pet") ?? "");
  const pet = pets.find((p) => p.id === petId) ?? pets[0];

  const [phase, setPhase] = useState<Phase>("ready");
  const [run, setRun] = useState(0);
  const [hud, setHud] = useState<Hud>({ score: 0 });
  const [best, setBest] = useState(() => (entry ? highScore.get(entry.key) : 0));
  const [lastScore, setLastScore] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<TrainingResult | null>(null);

  const perks = useMemo(() => strengthPerks(pet?.strength ?? 10), [pet?.strength]);
  const onHud = useCallback((h: Hud) => setHud(h), []);

  if (!entry || !def) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 mb-4">Unknown game.</p>
        <Link to="/games" className="text-purple-300">← Back to games</Link>
      </div>
    );
  }
  const { Component } = entry;

  // No pet, no game: every run is training for a real pet.
  if (!signedIn) return <SignInPrompt action="play games with your pet" />;
  if (!pet) {
    return (
      <div className="glass rounded-2xl p-8 sm:p-12 my-6 text-center flex flex-col items-center gap-4 max-w-lg mx-auto">
        <div className="text-5xl">🥚</div>
        <h1 className="text-lg font-bold text-white">
          {def.emoji} {def.name} needs a pet
        </h1>
        <p className="text-gray-400 text-sm">Your pet is the one who plays — and gets stronger. Hatch an egg first, then come back.</p>
        <Link to="/pets">
          <Button className="py-3 px-6">🥚 Get a pet</Button>
        </Link>
      </div>
    );
  }

  const start = async () => {
    setResult(null);
    setHud({ score: 0 });
    if (wallet) {
      if (pet.energy < def.energyCost) {
        showToast(`${pet.name} is too tired (needs ${def.energyCost} ⚡) — let it rest on its page first`, "error");
        return;
      }
      setPhase("starting");
      try {
        const { session, pet: updated } = await petApi.startTraining(pet.id, wallet, def.key);
        upsertPet(updated);
        setSessionId(session.id);
      } catch (err) {
        showToast(extractErrorMessage(err), "error");
        setPhase("ready");
        return;
      }
    } else {
      setSessionId(null);
    }
    setRun((r) => r + 1);
    setPhase("playing");
  };

  const gameOver = async (score: number) => {
    setLastScore(score);
    setBest(highScore.submit(def.key, score));
    if (!sessionId || !wallet) {
      setPhase("over");
      return;
    }
    setPhase("submitting");
    try {
      const res = await petApi.finishTraining(pet.id, sessionId, wallet, score);
      upsertPet(res.pet);
      setResult(res);
      if (res.leveledUp) showToast(`${res.pet.name} reached Level ${res.pet.level}! 🎉`, "levelup");
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    }
    setPhase("over");
  };

  const playing = phase === "playing";
  const lives = hud.lives;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link to="/games" className="text-sm text-gray-400 hover:text-white">
          ← Games
        </Link>
        <h1 className="text-lg sm:text-xl font-bold text-white truncate">
          {def.emoji} {def.name}
        </h1>
        <span className="text-xs text-gray-400 whitespace-nowrap">Best {best}</span>
      </div>

      {/* HUD */}
      <div className="glass rounded-xl px-4 py-2 flex items-center justify-between text-sm">
        <span className="font-bold text-white">Score {playing || phase === "submitting" ? hud.score : lastScore}</span>
        {lives !== undefined && <span>{"❤️".repeat(Math.max(0, lives))}</span>}
        {hud.shields !== undefined && hud.shields > 0 && <span className="text-sky-300">🛡×{hud.shields}</span>}
        <span className="text-emerald-300 text-xs truncate">💪 Training {pet.name}</span>
      </div>

      {playing && <Component key={run} pet={pet} perks={perks} onGameOver={gameOver} onHud={onHud} />}

      {(phase === "starting" || phase === "submitting") && <p className="text-center text-gray-400 py-16">{phase === "starting" ? "Warming up…" : "Counting your gains…"}</p>}

      {(phase === "ready" || phase === "over") && (
        <div className="glass rounded-2xl p-5 sm:p-6 flex flex-col items-center gap-4 text-center">
          {phase === "over" && !result && (
            <>
              <div className="text-3xl font-black text-red-300">GAME OVER</div>
              <div className="text-white text-lg">
                Score: <b>{lastScore}</b> · Best: <b>{best}</b>
              </div>
            </>
          )}
          {phase === "over" && result && (
            <>
              <div className="text-2xl font-black text-red-300">GAME OVER</div>
              <ResultView pet={result.pet} result={result} stat={def.stat} canAgain={result.pet.energy >= def.energyCost} onAgain={start} onDone={() => setPhase("ready")} />
            </>
          )}

          {phase === "ready" && (
            <>
              <PetPortrait art={pet} size={140} mood="run" />
              <p className="text-sm text-gray-300 max-w-md">{def.description}</p>
            </>
          )}

          {phase !== "over" && (
            <div className="w-full flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-center text-sm">
              <select
                value={pet.id}
                onChange={(e) => setPetId(e.target.value)}
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white"
              >
                {pets.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#12121f]">
                    {p.name} · 💪 {p.strength} · ⚡ {p.energy}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-400">Strength bonus: {perks.label}</span>
            </div>
          )}

          {!(phase === "over" && result) && (
            <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
              <Button className="flex-1 py-3" onClick={start}>
                {phase === "over" ? "PLAY AGAIN" : "PLAY"}
                {` · −${def.energyCost} ⚡`}
              </Button>
              {phase === "over" && (
                <Link to="/games" className="flex-1">
                  <Button variant="secondary" className="w-full py-3">
                    BACK TO GAMES
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
