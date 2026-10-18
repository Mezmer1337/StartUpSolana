import { useRef } from "react";
import type { FC } from "react";
import { PetPortrait } from "../PetViewer";
import { Button } from "../Button";
import { useActionKey, useGameLoop } from "./useGameLoop";
import type { TrainingGameProps } from "./useGameLoop";

const ROUNDS = 8;
const POINTS_PER_ROUND = 100 / ROUNDS;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Strength: a needle swings across a meter; stop it inside the green zone.
 * Each round the zone narrows and the needle speeds up. A dead-centre hit
 * is worth 12.5 points, the edge of the zone ~6, a miss 0.
 */
export const PowerGame: FC<TrainingGameProps> = ({ pet, onFinish }) => {
  // One mutable game-state object (mutated by the loop, read by render).
  const game = useRef({
    round: 0,
    needle: 0,
    dir: 1,
    zone: 0.5,
    phase: "aim" as "aim" | "hit" | "done",
    pauseMs: 0,
    results: [] as number[],
    punch: 0,
  });
  // Mutable game state lives in a ref: the loop mutates it, render reads a frame snapshot.
  const g = game.current;
  const zoneWidth = lerp(0.24, 0.08, g.round / (ROUNDS - 1));
  const speed = lerp(0.75, 2.0, g.round / (ROUNDS - 1));

  useGameLoop(g.phase !== "done", (dt) => {
    g.punch = Math.max(0, g.punch - dt / 300);
    if (g.phase === "aim") {
      g.needle += g.dir * speed * (dt / 1000);
      if (g.needle > 1) [g.needle, g.dir] = [2 - g.needle, -1];
      if (g.needle < 0) [g.needle, g.dir] = [-g.needle, 1];
    } else if (g.phase === "hit") {
      g.pauseMs -= dt;
      if (g.pauseMs <= 0) {
        if (g.results.length >= ROUNDS) {
          g.phase = "done";
          onFinish(Math.round(g.results.reduce((a, b) => a + b, 0)));
        } else {
          g.round = g.results.length;
          const w = lerp(0.24, 0.08, g.round / (ROUNDS - 1));
          g.zone = w / 2 + 0.05 + Math.random() * (0.9 - w);
          g.phase = "aim";
        }
      }
    }
  });

  const punch = () => {
    if (g.phase !== "aim") return;
    const half = zoneWidth / 2;
    const dist = Math.abs(g.needle - g.zone);
    const points = dist <= half ? POINTS_PER_ROUND * (1 - 0.5 * (dist / half)) : 0;
    g.results.push(points);
    g.phase = "hit";
    g.pauseMs = 650;
    g.punch = points > 0 ? 1 : 0;
  };
  useActionKey(g.phase === "aim", punch);

  const last = g.results[g.results.length - 1];
  const lastHit = g.phase === "hit" && last !== undefined;

  return (
    <div className="flex flex-col gap-4 select-none">
      <div className="flex items-center gap-4">
        <div style={{ transform: `translateX(${g.punch * 18}px) rotate(${g.punch * 6}deg)` }}>
          <PetPortrait art={pet} size={120} mood={lastHit && last > 0 ? "happy" : "idle"} />
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>
              Punch {Math.min(g.results.length + 1, ROUNDS)} / {ROUNDS}
            </span>
            <span>Score {Math.round(g.results.reduce((a, b) => a + b, 0))}</span>
          </div>
          <div className="relative h-10 rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div
              className="absolute inset-y-0 bg-emerald-400/40 border-x-2 border-emerald-300"
              style={{ left: `${(g.zone - zoneWidth / 2) * 100}%`, width: `${zoneWidth * 100}%` }}
            />
            <div className="absolute inset-y-0 w-1 bg-white shadow-[0_0_8px_white]" style={{ left: `calc(${g.needle * 100}% - 2px)` }} />
          </div>
          <div className="h-6 mt-1 text-center text-sm font-bold">
            {lastHit && (last > 0 ? <span className="text-emerald-300">+{last.toFixed(1)} 💥</span> : <span className="text-gray-400">Miss!</span>)}
          </div>
        </div>
      </div>
      <div className="flex gap-1 justify-center">
        {Array.from({ length: ROUNDS }, (_, i) => (
          <span key={i} className="text-lg">
            {g.results[i] === undefined ? "⚪" : g.results[i] >= POINTS_PER_ROUND * 0.85 ? "🟢" : g.results[i] > 0 ? "🟡" : "🔴"}
          </span>
        ))}
      </div>
      <Button onClick={punch} disabled={g.phase !== "aim"} className="w-full py-3 text-base">
        🥊 PUNCH! <span className="opacity-60 text-xs">(Space)</span>
      </Button>
    </div>
  );
};
