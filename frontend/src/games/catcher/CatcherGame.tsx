import { useEffect, useMemo, useRef, useState } from "react";
import type { FC, PointerEvent } from "react";
import { H, PLATFORM_Y, W, createCatcher, stepCatcher } from "./engine";
import type { CatcherInput, CatcherState } from "./engine";
import { drawCatcher } from "./render";
import { useCanvasGame } from "../common/canvas";
import { hudReporter } from "../ui/types";
import type { ArcadeGameProps } from "../ui/types";
import { PetPortrait } from "../../components/PetViewer";
import type { PetMood } from "../../../../shared/petArt";

const PET_W = 92;

export const CatcherGame: FC<ArcadeGameProps> = ({ pet, perks, onGameOver, onHud }) => {
  const state = useRef<CatcherState>(createCatcher(perks.extraLives));
  const input = useRef<CatcherInput>({ left: false, right: false, targetX: null });
  const report = useMemo(() => hudReporter(onHud), [onHud]);
  const ended = useRef(false);
  const petBox = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // Mood is the only React state touched during play, and only when it changes.
  const [mood, setMood] = useState<PetMood>("idle");
  const moodRef = useRef<PetMood>("idle");

  const canvasRef = useCanvasGame({
    width: W,
    height: H,
    running: true,
    step: (dt) => {
      const s = state.current;
      const events = stepCatcher(s, dt, input.current);
      report({ score: s.score, lives: s.lives });
      const moving = input.current.left || input.current.right || (input.current.targetX !== null && Math.abs(input.current.targetX - s.x) > 4);
      const nextMood: PetMood = s.hurtMs > 0 ? "sleep" : s.happyMs > 0 ? "happy" : moving ? "run" : "idle";
      if (nextMood !== moodRef.current) {
        moodRef.current = nextMood;
        setMood(nextMood);
      }
      if (events.includes("die") && !ended.current) {
        ended.current = true;
        onGameOver(s.score);
      }
    },
    draw: (ctx) => {
      drawCatcher(ctx, state.current, "#9945ff");
      // Keep the pet overlay glued to the platform (percentages = resolution-independent).
      const el = petBox.current;
      if (el) {
        el.style.left = `${((state.current.x - PET_W / 2) / W) * 100}%`;
        el.style.top = `${((PLATFORM_Y - PET_W * 0.95) / H) * 100}%`;
      }
    },
  });

  useEffect(() => {
    const set = (e: KeyboardEvent, down: boolean) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") input.current.left = down;
      else if (e.code === "ArrowRight" || e.code === "KeyD") input.current.right = down;
      else return;
      e.preventDefault();
      input.current.targetX = null; // keys take over from the pointer
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

  const pointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.buttons === 0 && e.type !== "pointermove") return;
    const rect = wrap.current?.getBoundingClientRect();
    if (rect) input.current.targetX = ((e.clientX - rect.left) / rect.width) * W;
  };

  const hold = (side: "left" | "right") => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      input.current.targetX = null;
      input.current[side] = true;
    },
    onPointerUp: () => (input.current[side] = false),
    onPointerLeave: () => (input.current[side] = false),
    onPointerCancel: () => (input.current[side] = false),
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={wrap}
        className="relative w-full max-w-[380px] rounded-xl overflow-hidden border border-purple-500/30 touch-none select-none"
        onPointerMove={pointer}
        onPointerDown={pointer}
      >
        <canvas ref={canvasRef} className="block" />
        <div ref={petBox} className="absolute pointer-events-none" style={{ width: `${(PET_W / W) * 100}%` }}>
          <PetPortrait art={pet} size={PET_W * 2} mood={mood} className="w-full h-auto" />
        </div>
      </div>
      <div className="flex gap-3 w-full max-w-[380px] md:hidden">
        <button type="button" {...hold("left")} className="flex-1 h-14 rounded-xl glass text-2xl text-white active:bg-purple-500/30 touch-none select-none">
          ◀
        </button>
        <button type="button" {...hold("right")} className="flex-1 h-14 rounded-xl glass text-2xl text-white active:bg-purple-500/30 touch-none select-none">
          ▶
        </button>
      </div>
      <p className="text-xs text-gray-500 text-center">
        <span className="hidden md:inline">A / D, arrows or the mouse · </span>drag your finger on the field · 🪙 +10 · SOL +50 · 💣 −1 life
      </p>
    </div>
  );
};
