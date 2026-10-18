// Block Runner — pure game logic. The pet runs up three lanes toward the
// top of the screen; blocks come at it. Switch lanes to dodge, grab SOL
// coins. Distance scores continuously; one hit ends the run (Strength
// shields absorb hits).

export const W = 360;
export const H = 560;
export const LANES = 3;
export const PLAYER_Y = H - 110;
export const PLAYER_SIZE = 84;
export const laneX = (lane: number) => (W / LANES) * (lane + 0.5);

export interface Obstacle {
  id: number;
  lane: number;
  y: number;
  kind: "block" | "coin";
  h: number;
}
export type RunnerEvent = "coin" | "shield" | "die" | "lane";

export interface RunnerState {
  t: number;
  lane: number;
  /** Smoothed x of the pet for the lane-change slide. */
  x: number;
  speed: number; // px/s the world scrolls at
  obstacles: Obstacle[];
  spawnIn: number;
  nextId: number;
  distance: number; // px travelled
  coins: number;
  score: number;
  alive: boolean;
  shields: number;
  invulnMs: number;
  /** Ground stripes offset, for the scrolling effect. */
  scroll: number;
}

export const COIN_POINTS = 20;
/** 1 point per 18 px run — ~13 pts/s at start, ~30 at top speed. */
const PX_PER_POINT = 18;

export function createRunner(shields = 0): RunnerState {
  return { t: 0, lane: 1, x: laneX(1), speed: 240, obstacles: [], spawnIn: 700, nextId: 1, distance: 0, coins: 0, score: 0, alive: true, shields, invulnMs: 0, scroll: 0 };
}

export function moveLane(s: RunnerState, delta: -1 | 1): boolean {
  const next = Math.max(0, Math.min(LANES - 1, s.lane + delta));
  if (next === s.lane || !s.alive) return false;
  s.lane = next;
  return true;
}

export function stepRunner(s: RunnerState, dtMs: number, rng: () => number = Math.random): RunnerEvent[] {
  const ev: RunnerEvent[] = [];
  if (!s.alive) return ev;
  const dt = dtMs / 1000;
  s.t += dtMs;
  s.invulnMs = Math.max(0, s.invulnMs - dtMs);
  s.speed = Math.min(540, 240 + s.t / 220); // ramps up over ~66 s
  s.distance += s.speed * dt;
  s.scroll = (s.scroll + s.speed * dt) % 60;
  s.x += (laneX(s.lane) - s.x) * Math.min(1, dt * 16);

  // Rows of blocks: 1–2 lanes blocked, never all three; coins in free lanes sometimes.
  s.spawnIn -= dtMs;
  if (s.spawnIn <= 0) {
    const blocked = new Set<number>();
    const count = rng() < 0.35 + Math.min(0.3, s.t / 200_000) ? 2 : 1;
    while (blocked.size < count) blocked.add(Math.floor(rng() * LANES));
    for (const lane of blocked) s.obstacles.push({ id: s.nextId++, lane, y: -60, kind: "block", h: 46 + rng() * 26 });
    const free = [0, 1, 2].filter((l) => !blocked.has(l));
    if (rng() < 0.55) s.obstacles.push({ id: s.nextId++, lane: free[Math.floor(rng() * free.length)], y: -40, kind: "coin", h: 30 });
    // Gap between rows shrinks with speed but always leaves time to switch lanes.
    s.spawnIn = Math.max(520, (300 / s.speed) * 1000 * (0.9 + rng() * 0.6));
  }

  const playerTop = PLAYER_Y - PLAYER_SIZE * 0.35;
  const playerBottom = PLAYER_Y + PLAYER_SIZE * 0.35;
  const playerLane = Math.round((s.x / W) * LANES - 0.5);
  s.obstacles = s.obstacles.filter((o) => {
    o.y += s.speed * dt;
    const overlaps = o.lane === playerLane && o.y + o.h / 2 > playerTop && o.y - o.h / 2 < playerBottom;
    if (overlaps) {
      if (o.kind === "coin") {
        s.coins += 1;
        ev.push("coin");
        return false;
      }
      if (s.invulnMs === 0) {
        if (s.shields > 0) {
          s.shields -= 1;
          s.invulnMs = 1200;
          ev.push("shield");
          return false;
        }
        s.alive = false;
        ev.push("die");
      }
    }
    return o.y - o.h < H + 20;
  });

  s.score = Math.floor(s.distance / PX_PER_POINT) + s.coins * COIN_POINTS;
  return ev;
}
