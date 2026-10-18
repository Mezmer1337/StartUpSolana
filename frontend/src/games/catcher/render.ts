import { H, PLATFORM_W, PLATFORM_Y, W } from "./engine";
import type { CatcherState } from "./engine";
import { drawSolCoin, roundRect } from "../common/canvas";

export function drawCatcher(ctx: CanvasRenderingContext2D, s: CatcherState, platformColor: string) {
  // Night sky.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#130f2e");
  sky.addColorStop(1, "#2a1550");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 24; i++) {
    const x = (i * 97) % W;
    const y = (i * 53 + s.t * 0.004 * ((i % 3) + 1)) % (H - 60);
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Items.
  for (const it of s.items) {
    if (it.kind === "bomb") {
      ctx.fillStyle = "#1f2937";
      ctx.beginPath();
      ctx.arc(it.x, it.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(it.x + 6, it.y - 9);
      ctx.quadraticCurveTo(it.x + 12, it.y - 18, it.x + 8, it.y - 22);
      ctx.stroke();
      ctx.fillStyle = Math.sin(s.t / 60) > 0 ? "#fde047" : "#f97316";
      ctx.beginPath();
      ctx.arc(it.x + 8, it.y - 23, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.scale(Math.max(0.25, Math.abs(Math.cos(it.spin))), 1); // spinning coin
      drawSolCoin(ctx, 0, 0, it.kind === "sol" ? 14 : 11, it.kind === "sol");
      ctx.restore();
    }
  }

  // Platform (the pet stands on it — drawn as a DOM overlay by the component).
  ctx.fillStyle = s.hurtMs > 0 ? "#ef4444" : platformColor;
  roundRect(ctx, s.x - PLATFORM_W / 2, PLATFORM_Y, PLATFORM_W, 12, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  roundRect(ctx, s.x - PLATFORM_W / 2 + 6, PLATFORM_Y + 2, PLATFORM_W - 12, 3, 2);
  ctx.fill();

  // Floating "+10" / "−1 ❤".
  ctx.textAlign = "center";
  ctx.font = "bold 15px system-ui, sans-serif";
  for (const p of s.popups) {
    ctx.globalAlpha = Math.min(1, p.ttl / 400);
    ctx.fillStyle = p.good ? "#14f195" : "#f87171";
    ctx.fillText(p.text, p.x, p.y - (800 - p.ttl) / 14);
  }
  ctx.globalAlpha = 1;
}
