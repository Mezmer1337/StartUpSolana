import { useEffect, useRef } from "react";
import type { FC, PointerEvent } from "react";
import { PetPortrait } from "../PetViewer";
import { useGameLoop } from "./useGameLoop";
import type { TrainingGameProps } from "./useGameLoop";
import { GAME_DURATION_MS } from "../../../../shared/game/training";

const W = 600;
const H = 320;
const PET_SIZE = 90;
const CATCH_RADIUS = 52;
const SPAWN_MS = 430;
const KEY_SPEED = 520; // px/s with arrow keys

type Kind = "snack" | "clover" | "rock";
const ITEMS: Record<Kind, { points: number; emojis: string[] }> = {
  snack: { points: 2, emojis: ["🍓", "🍎", "🍪", "🍌", "🧁"] },
  clover: { points: 5, emojis: ["🍀"] },
  rock: { points: -3, emojis: ["🪨"] },
};

interface Item {
  id: number;
  x: number;
  y: number;
  vy: number;
  kind: Kind;
  emoji: string;
}
interface Popup {
  id: number;
  x: number;
  y: number;
  text: string;
  ttl: number;
}

/** Luck: catch falling snacks (+2) and clovers (+5), dodge rocks (−3). 30 s. */
export const CatchGame: FC<TrainingGameProps> = ({ pet, onFinish }) => {
  const game = useRef({
    t: 0,
    petX: W / 2,
    items: [] as Item[],
    popups: [] as Popup[],
    spawnIn: 300,
    nextId: 1,
    score: 0,
    happyMs: 0,
    shakeMs: 0,
    done: false,
  });
  // Mutable game state lives in a ref: the loop mutates it, render reads a frame snapshot.
  const g = game.current;
  const keys = useRef({ left: false, right: false });
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") keys.current.left = down;
      if (e.code === "ArrowRight" || e.code === "KeyD") keys.current.right = down;
    };
    const kd = (e: KeyboardEvent) => set(e, true);
    const ku = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  useGameLoop(!g.done, (dt) => {
    const s = dt / 1000;
    g.t += dt;
    g.happyMs = Math.max(0, g.happyMs - dt);
    g.shakeMs = Math.max(0, g.shakeMs - dt);
    const dir = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
    g.petX = Math.min(W - PET_SIZE / 2, Math.max(PET_SIZE / 2, g.petX + dir * KEY_SPEED * s));

    g.spawnIn -= dt;
    if (g.spawnIn <= 0) {
      const roll = Math.random();
      const kind: Kind = roll < 0.1 ? "clover" : roll < 0.32 ? "rock" : "snack";
      const pool = ITEMS[kind].emojis;
      g.items.push({
        id: g.nextId++,
        x: 30 + Math.random() * (W - 60),
        y: -20,
        vy: 150 + Math.random() * 90 + g.t / 120,
        kind,
        emoji: pool[Math.floor(Math.random() * pool.length)],
      });
      g.spawnIn = SPAWN_MS;
    }

    const catchY = H - PET_SIZE * 0.55;
    g.items = g.items.filter((it) => {
      it.y += it.vy * s;
      if (it.y > catchY - 18 && it.y < catchY + 18 && Math.abs(it.x - g.petX) < CATCH_RADIUS) {
        const pts = ITEMS[it.kind].points;
        g.score = Math.max(0, Math.min(100, g.score + pts));
        g.popups.push({ id: it.id, x: it.x, y: it.y, text: pts > 0 ? `+${pts}` : `${pts}`, ttl: 700 });
        if (pts > 0) g.happyMs = 600;
        else g.shakeMs = 400;
        return false;
      }
      return it.y < H + 30;
    });
    g.popups = g.popups.filter((p) => (p.ttl -= dt) > 0);

    if (g.t >= GAME_DURATION_MS) {
      g.done = true;
      onFinish(g.score);
    }
  });

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = field.current?.getBoundingClientRect();
    if (!rect) return;
    g.petX = Math.min(W - PET_SIZE / 2, Math.max(PET_SIZE / 2, ((e.clientX - rect.left) / rect.width) * W));
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const shake = g.shakeMs > 0 ? Math.sin(g.shakeMs / 25) * 6 : 0;

  return (
    <div className="flex flex-col gap-3 select-none">
      <div className="flex justify-between text-sm">
        <span className="text-gray-300">⏱ {Math.max(0, Math.ceil((GAME_DURATION_MS - g.t) / 1000))}s</span>
        <span className="font-bold text-white">Score {g.score}</span>
      </div>
      <div
        ref={field}
        className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-indigo-950/70 to-purple-900/40 touch-none cursor-none"
        style={{ aspectRatio: `${W} / ${H}` }}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
      >
        {g.items.map((it) => (
          <span
            key={it.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-2xl sm:text-3xl"
            style={{ left: pct(it.x, W), top: pct(it.y, H) }}
          >
            {it.emoji}
          </span>
        ))}
        {g.popups.map((p) => (
          <span
            key={p.id}
            className={`absolute -translate-x-1/2 font-bold text-sm ${p.text.startsWith("+") ? "text-emerald-300" : "text-red-400"}`}
            style={{ left: pct(p.x, W), top: pct(p.y - (700 - p.ttl) / 12, H), opacity: p.ttl / 700 }}
          >
            {p.text}
          </span>
        ))}
        <div
          className="absolute"
          style={{
            left: pct(g.petX - PET_SIZE / 2 + shake, W),
            width: pct(PET_SIZE, W),
            top: pct(H - PET_SIZE, H),
          }}
        >
          <PetPortrait art={pet} size={PET_SIZE * 2} mood={g.happyMs > 0 ? "happy" : "idle"} className="w-full h-auto" />
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center">Move with the mouse / finger or ← → keys · 🍀 = +5 · 🪨 = −3</p>
    </div>
  );
};
