import { useEffect, useMemo, useRef } from "react";
import type { FC, TouchEvent } from "react";
import { createSnake, stepSnake, turn } from "./engine";
import type { Dir, SnakeState } from "./engine";
import { CELL, drawSnake } from "./render";
import { useCanvasGame, useImage } from "../common/canvas";
import { hudReporter } from "../ui/types";
import type { ArcadeGameProps } from "../ui/types";
import { lookFromRecord, renderPetSvgFromRecord, sampleRamp, svgToDataUri } from "../../../../shared/petArt";

const KEYS: Record<string, Dir> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

export const SnakeGame: FC<ArcadeGameProps> = ({ pet, perks, onGameOver, onHud }) => {
  const state = useRef<SnakeState>(createSnake({ shields: perks.shields }));
  const report = useMemo(() => hudReporter(onHud), [onHud]);
  const ended = useRef(false);

  const headSrc = useMemo(() => svgToDataUri(renderPetSvgFromRecord(pet)), [pet]);
  const head = useImage(headSrc);
  const colors = useMemo(() => {
    const stops = lookFromRecord(pet).palette.stops;
    return { body: sampleRamp(stops, 0.55), bodyDark: sampleRamp(stops, 0.8) };
  }, [pet]);

  const canvasRef = useCanvasGame({
    width: state.current.cols * CELL,
    height: state.current.rows * CELL,
    running: true,
    step: (dt) => {
      const s = state.current;
      const events = stepSnake(s, dt);
      report({ score: s.score, shields: s.shields });
      if (events.includes("die") && !ended.current) {
        ended.current = true;
        onGameOver(s.score);
      }
    },
    draw: (ctx) => drawSnake(ctx, state.current, { ...colors, head: head.current }),
  });

  // Keyboard: WASD / arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.code];
      if (!dir) return;
      e.preventDefault();
      turn(state.current, dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Swipe on the board.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => (touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    turn(state.current, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };

  const pad = (dir: Dir, label: string) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        turn(state.current, dir);
      }}
      className="h-14 rounded-xl glass text-2xl text-white active:bg-purple-500/30 touch-manipulation select-none"
      aria-label={dir}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-[420px] rounded-xl overflow-hidden border border-purple-500/30 touch-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <canvas ref={canvasRef} className="block" />
      </div>
      {/* On-screen D-pad (phones/tablets; also clickable on desktop). */}
      <div className="grid grid-cols-3 gap-2 w-56 md:hidden">
        <span />
        {pad("up", "↑")}
        <span />
        {pad("left", "←")}
        {pad("down", "↓")}
        {pad("right", "→")}
      </div>
      <p className="hidden md:block text-xs text-gray-500">W A S D / arrow keys</p>
    </div>
  );
};
