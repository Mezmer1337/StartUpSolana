import { H, LANES, W, laneX } from "./engine";
import type { RunnerState } from "./engine";
import { drawSolCoin, roundRect } from "../common/canvas";

export function drawRunner(ctx: CanvasRenderingContext2D, s: RunnerState) {
  // Track.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b0a1f");
  bg.addColorStop(1, "#1d1240");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Lane dividers scroll toward the player.
  ctx.strokeStyle = "rgba(20,241,149,0.25)";
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 34]);
  ctx.lineDashOffset = -s.scroll;
  for (let i = 1; i < LANES; i++) {
    const x = (W / LANES) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Speed lines at the edges.
  ctx.fillStyle = "rgba(153,69,255,0.18)";
  for (let i = 0; i < 6; i++) {
    const y = (i * 110 + s.scroll * 3) % H;
    ctx.fillRect(4, y, 3, 40);
    ctx.fillRect(W - 7, (y + 55) % H, 3, 40);
  }

  for (const o of s.obstacles) {
    const x = laneX(o.lane);
    if (o.kind === "coin") {
      drawSolCoin(ctx, x, o.y, 13, true);
      continue;
    }
    const w = W / LANES - 26;
    const g = ctx.createLinearGradient(0, o.y - o.h / 2, 0, o.y + o.h / 2);
    g.addColorStop(0, "#f472b6");
    g.addColorStop(1, "#9945ff");
    ctx.fillStyle = g;
    roundRect(ctx, x - w / 2, o.y - o.h / 2, w, o.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Block "bricks".
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 6, o.y);
    ctx.lineTo(x + w / 2 - 6, o.y);
    ctx.stroke();
  }

  // Shield bubble around the pet while invulnerable.
  if (s.invulnMs > 0 && Math.floor(s.invulnMs / 100) % 2 === 0) {
    ctx.strokeStyle = "rgba(125,211,252,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, H - 110, 48, 0, Math.PI * 2);
    ctx.stroke();
  }
}
