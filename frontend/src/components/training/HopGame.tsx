import { useRef } from "react";
import type { FC } from "react";
import { PetPortrait } from "../PetViewer";
import { useActionKey, useGameLoop } from "./useGameLoop";
import type { TrainingGameProps } from "./useGameLoop";
import { GAME_DURATION_MS } from "../../../../shared/game/training";

// Logical playfield (rendered in % so it scales to any width).
const W = 600;
const H = 220;
const GROUND = 196;
const PET_X = 40;
const PET_SIZE = 76;
const GRAVITY = 2300;
const JUMP_V = 780;
const POINTS_PER_ROCK = 4;

interface Rock {
  id: number;
  x: number;
  w: number;
  h: number;
  passed: boolean;
}

/** Speed: an endless hop over rocks. 30 s, 3 hearts; +4 per rock cleared. */
export const HopGame: FC<TrainingGameProps> = ({ pet, onFinish }) => {
  const game = useRef({
    t: 0,
    y: 0, // height above ground
    vy: 0,
    rocks: [] as Rock[],
    nextRockIn: 900,
    nextId: 1,
    hearts: 3,
    invulnMs: 0,
    score: 0,
    done: false,
  });
  // Mutable game state lives in a ref: the loop mutates it, render reads a frame snapshot.
  const g = game.current;

  useGameLoop(!g.done, (dt) => {
    const s = dt / 1000;
    g.t += dt;
    const speed = 270 + (g.t / 1000) * 9; // px/s, ramps up over the run

    // Pet physics.
    if (g.y > 0 || g.vy > 0) {
      g.vy -= GRAVITY * s;
      g.y = Math.max(0, g.y + g.vy * s);
      if (g.y === 0) g.vy = 0;
    }
    g.invulnMs = Math.max(0, g.invulnMs - dt);

    // Rocks.
    g.nextRockIn -= dt;
    if (g.nextRockIn <= 0) {
      g.rocks.push({ id: g.nextId++, x: W + 10, w: 24 + Math.random() * 18, h: 24 + Math.random() * 26, passed: false });
      // Never closer than one full jump (~0.68 s airtime) + landing room.
      g.nextRockIn = Math.max(820, (1000 + Math.random() * 800) * (270 / speed) * 1.2);
    }
    for (const r of g.rocks) {
      r.x -= speed * s;
      const petLeft = PET_X + 18;
      const petRight = PET_X + PET_SIZE - 18;
      if (!r.passed && r.x + r.w < petLeft) {
        r.passed = true;
        g.score = Math.min(100, g.score + POINTS_PER_ROCK);
      }
      const overlapX = r.x < petRight && r.x + r.w > petLeft;
      if (overlapX && g.y < r.h - 6 && g.invulnMs === 0 && !r.passed) {
        g.hearts -= 1;
        g.invulnMs = 1100;
      }
    }
    g.rocks = g.rocks.filter((r) => r.x + r.w > -20);

    if (g.t >= GAME_DURATION_MS || g.hearts <= 0) {
      g.done = true;
      onFinish(g.score);
    }
  });

  const jump = () => {
    if (!g.done && g.y === 0) g.vy = JUMP_V;
  };
  useActionKey(!g.done, jump);

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const blink = g.invulnMs > 0 && Math.floor(g.invulnMs / 120) % 2 === 0;

  return (
    <div className="flex flex-col gap-3 select-none">
      <div className="flex justify-between text-sm">
        <span>{"❤️".repeat(Math.max(0, g.hearts))}{"🖤".repeat(3 - Math.max(0, g.hearts))}</span>
        <span className="text-gray-300">⏱ {Math.max(0, Math.ceil((GAME_DURATION_MS - g.t) / 1000))}s</span>
        <span className="font-bold text-white">Score {g.score}</span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-sky-900/40 to-indigo-950/60 cursor-pointer touch-manipulation"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={jump}
      >
        <div className="absolute inset-x-0 bg-emerald-900/60 border-t-2 border-emerald-400/50" style={{ top: pct(GROUND, H), bottom: 0 }} />
        {g.rocks.map((r) => (
          <div
            key={r.id}
            className="absolute rounded-t-lg bg-gradient-to-b from-stone-400 to-stone-600 border border-stone-300/40"
            style={{ left: pct(r.x, W), width: pct(r.w, W), top: pct(GROUND - r.h, H), height: pct(r.h, H) }}
          />
        ))}
        <div
          className="absolute"
          style={{
            left: pct(PET_X, W),
            width: pct(PET_SIZE, W),
            top: pct(GROUND - PET_SIZE - g.y + 6, H),
            opacity: blink ? 0.35 : 1,
          }}
        >
          <PetPortrait art={pet} size={PET_SIZE * 2} mood={g.y > 0 ? "happy" : "idle"} className="w-full h-auto" />
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center">Space / ↑ / tap to jump</p>
    </div>
  );
};
