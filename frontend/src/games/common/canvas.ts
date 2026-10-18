import { useEffect, useRef } from "react";

/**
 * Drives a canvas game: sizes the canvas to its container (crisp on HiDPI),
 * runs one requestAnimationFrame loop, and calls `step` (game logic) then
 * `draw` (rendering) each frame. React is not re-rendered per frame — the
 * caller pushes HUD changes to React itself, only when values change.
 *
 * Logical coordinates: the game draws in a fixed `width × height` space;
 * the canvas is scaled to fit the container width.
 */
export function useCanvasGame(opts: {
  width: number;
  height: number;
  running: boolean;
  step: (dtMs: number) => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  // Resize to container, keeping the logical aspect ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const cssW = canvas.parentElement?.clientWidth ?? opts.width;
      const scale = cssW / opts.width;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${opts.height * scale}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(opts.height * scale * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      if (ctx) cb.current.draw(ctx);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [opts.width, opts.height]);

  useEffect(() => {
    if (!opts.running) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last); // a background tab must not teleport objects
      last = now;
      cb.current.step(dt);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) cb.current.draw(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [opts.running]);

  return canvasRef;
}

/** Loads an SVG/data-URI image once for drawing on canvas (null until ready). */
export function useImage(src: string | null) {
  const img = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      img.current = null;
      return;
    }
    const el = new Image();
    el.onload = () => (img.current = el);
    el.src = src;
  }, [src]);
  return img;
}

/** Best score per game in this browser (storage may be unavailable — never throws). */
export const highScore = {
  get(game: string): number {
    try {
      return Number(localStorage.getItem(`petnft.best.${game}`) ?? 0) || 0;
    } catch {
      return 0;
    }
  },
  submit(game: string, score: number): number {
    const best = Math.max(score, highScore.get(game));
    try {
      localStorage.setItem(`petnft.best.${game}`, String(best));
    } catch {
      /* private mode etc. — the in-memory value still shows */
    }
    return best;
  },
};

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A SOL-style coin: gradient disc with three slanted bars. */
export function drawSolCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rare = false) {
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  if (rare) {
    g.addColorStop(0, "#9945ff");
    g.addColorStop(1, "#14f195");
  } else {
    g.addColorStop(0, "#ffe27a");
    g.addColorStop(1, "#f59e0b");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = rare ? "#ffffff" : "#7c4a03";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    const yy = y + i * r * 0.36;
    ctx.moveTo(x - r * 0.42 + r * 0.12, yy - r * 0.1);
    ctx.lineTo(x + r * 0.52, yy - r * 0.1);
    ctx.lineTo(x + r * 0.42 - r * 0.12, yy + r * 0.1);
    ctx.lineTo(x - r * 0.52, yy + r * 0.1);
    ctx.closePath();
    ctx.fill();
  }
}
