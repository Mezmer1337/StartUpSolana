// Sol Catcher — pure game logic. The pet rides a platform at the bottom;
// coins (+10), rare SOL (+50) and bombs (−1 life) fall from the top.

export type ItemKind = "coin" | "sol" | "bomb";
export interface FallingItem {
  id: number;
  x: number;
  y: number;
  vy: number;
  kind: ItemKind;
  spin: number;
}
export interface Popup {
  id: number;
  x: number;
  y: number;
  text: string;
  good: boolean;
  ttl: number;
}
export type CatcherEvent = "coin" | "sol" | "bomb" | "die";

export const W = 360;
export const H = 520;
export const PLATFORM_Y = H - 46;
export const PLATFORM_W = 96;
const PLATFORM_SPEED = 430; // px/s with keys
export const POINTS: Record<Exclude<ItemKind, "bomb">, number> = { coin: 10, sol: 50 };

export interface CatcherState {
  t: number;
  x: number; // platform centre
  items: FallingItem[];
  popups: Popup[];
  spawnIn: number;
  nextId: number;
  score: number;
  lives: number;
  alive: boolean;
  hurtMs: number;
  happyMs: number;
}

export function createCatcher(extraLives = 0): CatcherState {
  return { t: 0, x: W / 2, items: [], popups: [], spawnIn: 500, nextId: 1, score: 0, lives: 3 + extraLives, alive: true, hurtMs: 0, happyMs: 0 };
}

export interface CatcherInput {
  left: boolean;
  right: boolean;
  /** Pointer/finger x in logical coords (wins over keys while set). */
  targetX: number | null;
}

/** Difficulty 0 → 1 over the first ~90 s. */
const difficulty = (t: number) => Math.min(1, t / 90_000);

export function stepCatcher(s: CatcherState, dtMs: number, input: CatcherInput, rng: () => number = Math.random): CatcherEvent[] {
  const ev: CatcherEvent[] = [];
  if (!s.alive) return ev;
  const dt = dtMs / 1000;
  s.t += dtMs;
  s.hurtMs = Math.max(0, s.hurtMs - dtMs);
  s.happyMs = Math.max(0, s.happyMs - dtMs);
  const d = difficulty(s.t);

  // Platform.
  const half = PLATFORM_W / 2;
  if (input.targetX !== null) {
    const delta = input.targetX - s.x;
    s.x += Math.sign(delta) * Math.min(Math.abs(delta), PLATFORM_SPEED * 1.8 * dt);
  } else {
    s.x += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * PLATFORM_SPEED * dt;
  }
  s.x = Math.max(half, Math.min(W - half, s.x));

  // Spawning: faster and denser over time.
  s.spawnIn -= dtMs;
  if (s.spawnIn <= 0) {
    const roll = rng();
    const kind: ItemKind = roll < 0.07 ? "sol" : roll < 0.07 + 0.16 + d * 0.1 ? "bomb" : "coin";
    s.items.push({ id: s.nextId++, x: 18 + rng() * (W - 36), y: -16, vy: 120 + rng() * 60 + d * 170, kind, spin: rng() * Math.PI });
    s.spawnIn = 760 - d * 400 + rng() * 200;
  }

  // Falling + catching.
  s.items = s.items.filter((it) => {
    it.y += it.vy * dt;
    it.spin += dt * 4;
    const onPlatform = it.y >= PLATFORM_Y - 14 && it.y <= PLATFORM_Y + 8 && Math.abs(it.x - s.x) <= half + 6;
    if (onPlatform) {
      if (it.kind === "bomb") {
        s.lives -= 1;
        s.hurtMs = 600;
        s.popups.push({ id: it.id, x: it.x, y: it.y, text: "−1 ❤", good: false, ttl: 800 });
        ev.push("bomb");
        if (s.lives <= 0) {
          s.alive = false;
          ev.push("die");
        }
      } else {
        const pts = POINTS[it.kind];
        s.score += pts;
        s.happyMs = 500;
        s.popups.push({ id: it.id, x: it.x, y: it.y, text: `+${pts}`, good: true, ttl: 700 });
        ev.push(it.kind);
      }
      return false;
    }
    return it.y < H + 20; // missing a coin costs nothing
  });
  s.popups = s.popups.filter((p) => (p.ttl -= dtMs) > 0);
  return ev;
}
