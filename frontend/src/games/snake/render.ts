import type { SnakeState } from "./engine";
import { drawSolCoin, roundRect } from "../common/canvas";

export const CELL = 20;

/** Draws one frame of Solana Snake in logical pixels (cols*CELL × rows*CELL). */
export function drawSnake(ctx: CanvasRenderingContext2D, s: SnakeState, opts: { body: string; bodyDark: string; head: HTMLImageElement | null }) {
  const W = s.cols * CELL;
  const H = s.rows * CELL;

  // Board: dark with a faint grid.
  ctx.fillStyle = "#0f0d22";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(153,69,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < s.cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, H);
    ctx.stroke();
  }
  for (let i = 1; i < s.rows; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(W, i * CELL);
    ctx.stroke();
  }

  // Coin with a soft pulse.
  const pulse = 1 + Math.sin(performance.now() / 180) * 0.06;
  drawSolCoin(ctx, s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL * 0.42 * pulse);

  // Body tail → neck, in the pet's colours (alternating shades).
  for (let i = s.snake.length - 1; i >= 1; i--) {
    const c = s.snake[i];
    ctx.fillStyle = i % 2 ? opts.body : opts.bodyDark;
    const inset = 2 + (i / s.snake.length) * 2;
    roundRect(ctx, c.x * CELL + inset, c.y * CELL + inset, CELL - inset * 2, CELL - inset * 2, 6);
    ctx.fill();
  }

  // Head: the pet itself, slightly bigger than a cell.
  const h = s.snake[0];
  const size = CELL * 1.9;
  const hx = h.x * CELL + CELL / 2 - size / 2;
  const hy = h.y * CELL + CELL / 2 - size * 0.62;
  if (s.flashMs > 0) {
    ctx.fillStyle = s.stunned ? "rgba(56,189,248,0.35)" : "rgba(20,241,149,0.3)";
    ctx.beginPath();
    ctx.arc(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, CELL, 0, Math.PI * 2);
    ctx.fill();
  }
  if (opts.head) ctx.drawImage(opts.head, hx, hy, size, size);
  else {
    ctx.fillStyle = opts.body;
    roundRect(ctx, h.x * CELL + 1, h.y * CELL + 1, CELL - 2, CELL - 2, 7);
    ctx.fill();
  }

  if (s.stunned) {
    ctx.fillStyle = "rgba(15,13,34,0.55)";
    ctx.fillRect(0, H / 2 - 18, W, 36);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🛡 Shield used — steer to keep going!", W / 2, H / 2 + 5);
  }
}
