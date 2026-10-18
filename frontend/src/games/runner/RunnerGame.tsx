import { useEffect, useMemo, useRef } from "react";
import type { FC, TouchEvent } from "react";
import { H, PLAYER_SIZE, PLAYER_Y, W, createRunner, moveLane, stepRunner } from "./engine";
import type { RunnerState } from "./engine";
import { drawRunner } from "./render";
import { useCanvasGame } from "../common/canvas";
import { hudReporter } from "../ui/types";
import type { ArcadeGameProps } from "../ui/types";
import { PetPortrait } from "../../components/PetViewer";

export const RunnerGame: FC<ArcadeGameProps> = ({ pet, perks, onGameOver, onHud }) => {
  const state = useRef<RunnerState>(createRunner(perks.shields));
  const report = useMemo(() => hudReporter(onHud), [onHud]);
  const ended = useRef(false);
  const petBox = useRef<HTMLDivElement>(null);

  const canvasRef = useCanvasGame({
    width: W,
    height: H,
    running: true,
    step: (dt) => {
      const s = state.current;
      const events = stepRunner(s, dt);
      report({ score: s.score, shields: s.shields });
      if (events.includes("die") && !ended.current) {
        ended.current = true;
        onGameOver(s.score);
      }
    },
    draw: (ctx) => {
      drawRunner(ctx, state.current);
      const el = petBox.current;
      if (el) {
        el.style.left = `${((state.current.x - PLAYER_SIZE / 2) / W) * 100}%`;
        el.style.opacity = state.current.alive ? "1" : "0.4";
      }
    },
  });

  const move = (d: -1 | 1) => moveLane(state.current, d);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") move(-1);
      else if (e.code === "ArrowRight" || e.code === "KeyD") move(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Swipe, or tap the left/right half of the track.
  const start = useRef<number | null>(null);
  const onTouchStart = (e: TouchEvent) => (start.current = e.touches[0].clientX);
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const x = e.changedTouches[0].clientX;
    const dx = x - start.current;
    if (Math.abs(dx) > 20) move(dx > 0 ? 1 : -1);
    else {
      const rect = e.currentTarget.getBoundingClientRect();
      move(x - rect.left < rect.width / 2 ? -1 : 1);
    }
    start.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative w-full max-w-[360px] rounded-xl overflow-hidden border border-purple-500/30 touch-none select-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <canvas ref={canvasRef} className="block" />
        <div
          ref={petBox}
          className="absolute pointer-events-none"
          style={{ width: `${(PLAYER_SIZE / W) * 100}%`, top: `${((PLAYER_Y - PLAYER_SIZE * 0.62) / H) * 100}%` }}
        >
          <PetPortrait art={pet} size={PLAYER_SIZE * 2} mood="run" className="w-full h-auto" />
        </div>
      </div>
      <div className="flex gap-3 w-full max-w-[360px] md:hidden">
        <button type="button" onPointerDown={() => move(-1)} className="flex-1 h-14 rounded-xl glass text-2xl text-white active:bg-purple-500/30 touch-manipulation select-none">
          ◀
        </button>
        <button type="button" onPointerDown={() => move(1)} className="flex-1 h-14 rounded-xl glass text-2xl text-white active:bg-purple-500/30 touch-manipulation select-none">
          ▶
        </button>
      </div>
      <p className="text-xs text-gray-500 text-center">
        <span className="hidden md:inline">A / D or ← → to switch lanes · </span>swipe or tap a side · SOL coin +20
      </p>
    </div>
  );
};
