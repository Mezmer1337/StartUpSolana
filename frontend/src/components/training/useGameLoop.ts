import { useEffect, useReducer, useRef } from "react";
import type { PetArtRecord } from "../../../../shared/petArt";

/**
 * requestAnimationFrame loop for the training games. `tick` gets the frame
 * delta (ms, clamped so a background tab can't teleport objects) and runs
 * against refs; the hook re-renders once per frame afterwards.
 */
export function useGameLoop(active: boolean, tick: (dtMs: number) => void) {
  const tickRef = useRef(tick);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      tickRef.current(dt);
      rerender();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** Space / ArrowUp / Enter -> action (ignores key repeat). */
export function useActionKey(active: boolean, onAction: () => void) {
  const ref = useRef(onAction);
  useEffect(() => {
    ref.current = onAction;
  });
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "Enter") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active]);
}

// Games keep their state in a ref mutated by the loop and re-render once
// per frame (see useGameLoop) — the standard game-loop pattern; the linter's
// "refs during render" warnings are expected here.
export interface TrainingGameProps {
  /** Only the art fields are needed, so the dev Lab can pass a sample pet. */
  pet: PetArtRecord;
  /** Called exactly once with the final score (0..100). */
  onFinish: (score: number) => void;
}
