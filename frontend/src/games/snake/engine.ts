// Solana Snake — pure game logic (no DOM, no React). The UI feeds input via
// turn() and advances time via step(); rendering reads the state.

export type Dir = "up" | "down" | "left" | "right";
export interface Cell {
  x: number;
  y: number;
}
export type SnakeEvent = "eat" | "shield" | "die";

export interface SnakeState {
  cols: number;
  rows: number;
  /** Head first. */
  snake: Cell[];
  dir: Dir;
  queue: Dir[];
  food: Cell;
  score: number;
  eaten: number;
  /** ms per grid step — shrinks as the snake eats. */
  stepMs: number;
  acc: number;
  alive: boolean;
  /** Strength perk: survive a crash; the snake stops until you steer away. */
  shields: number;
  stunned: boolean;
  /** Visual pulse after eating/a shield (ms left). */
  flashMs: number;
}

export const COIN_POINTS = 10;
const START_STEP_MS = 150;
const MIN_STEP_MS = 65;
const SPEEDUP_EVERY = 3; // coins
const SPEEDUP_MS = 7;

const VEC: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

export function createSnake(opts: { cols?: number; rows?: number; shields?: number; rng?: () => number } = {}): SnakeState {
  const cols = opts.cols ?? 18;
  const rows = opts.rows ?? 18;
  const cy = Math.floor(rows / 2);
  const snake = [3, 2, 1].map((x) => ({ x, y: cy }));
  const s: SnakeState = {
    cols,
    rows,
    snake,
    dir: "right",
    queue: [],
    food: { x: 0, y: 0 },
    score: 0,
    eaten: 0,
    stepMs: START_STEP_MS,
    acc: 0,
    alive: true,
    shields: opts.shields ?? 0,
    stunned: false,
    flashMs: 0,
  };
  s.food = spawnFood(s, opts.rng ?? Math.random);
  return s;
}

/** Queue a direction change (max 2 ahead, so quick double-taps still register). */
export function turn(s: SnakeState, dir: Dir) {
  const last = s.queue[s.queue.length - 1] ?? s.dir;
  if (dir === last || dir === OPPOSITE[last]) return;
  if (s.queue.length < 2) s.queue.push(dir);
  s.stunned = false;
}

function spawnFood(s: SnakeState, rng: () => number): Cell {
  const free: Cell[] = [];
  for (let y = 0; y < s.rows; y++)
    for (let x = 0; x < s.cols; x++) if (!s.snake.some((c) => c.x === x && c.y === y)) free.push({ x, y });
  return free[Math.floor(rng() * free.length)] ?? { x: 0, y: 0 };
}

/** Advance time. Returns what happened this frame (for sounds/effects/HUD). */
export function stepSnake(s: SnakeState, dtMs: number, rng: () => number = Math.random): SnakeEvent[] {
  const events: SnakeEvent[] = [];
  if (!s.alive) return events;
  s.flashMs = Math.max(0, s.flashMs - dtMs);
  if (s.stunned) return events;
  s.acc += dtMs;

  while (s.acc >= s.stepMs && s.alive && !s.stunned) {
    s.acc -= s.stepMs;
    const next = s.queue.shift();
    if (next) s.dir = next;
    const v = VEC[s.dir];
    const head = { x: s.snake[0].x + v.x, y: s.snake[0].y + v.y };
    const eating = head.x === s.food.x && head.y === s.food.y;
    // The tail moves away this step unless we grow, so it isn't an obstacle.
    const body = eating ? s.snake : s.snake.slice(0, -1);
    const hitWall = head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows;
    const hitSelf = body.some((c) => c.x === head.x && c.y === head.y);

    if (hitWall || hitSelf) {
      if (s.shields > 0) {
        s.shields -= 1;
        s.stunned = true;
        s.queue = [];
        s.acc = 0;
        s.flashMs = 500;
        events.push("shield");
      } else {
        s.alive = false;
        events.push("die");
      }
      break;
    }

    s.snake.unshift(head);
    if (eating) {
      s.score += COIN_POINTS;
      s.eaten += 1;
      s.flashMs = 180;
      if (s.eaten % SPEEDUP_EVERY === 0) s.stepMs = Math.max(MIN_STEP_MS, s.stepMs - SPEEDUP_MS);
      s.food = spawnFood(s, rng);
      events.push("eat");
    } else {
      s.snake.pop();
    }
  }
  return events;
}
