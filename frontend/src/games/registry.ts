import type { FC } from "react";
import type { TrainingGameKey } from "../../../shared/game/training";
import type { ArcadeGameProps } from "./ui/types";
import { SnakeGame } from "./snake/SnakeGame";
import { CatcherGame } from "./catcher/CatcherGame";
import { RunnerGame } from "./runner/RunnerGame";

/** URL slug (/games/:slug) -> arcade game. Add a game = engine + component + one line here + a def in shared/game/training.ts. */
export const ARCADE: Record<string, { key: TrainingGameKey; Component: FC<ArcadeGameProps> }> = {
  snake: { key: "SNAKE", Component: SnakeGame },
  catcher: { key: "CATCHER", Component: CatcherGame },
  runner: { key: "RUNNER", Component: RunnerGame },
};
