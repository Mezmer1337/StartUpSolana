import type { PetArtRecord } from "../../../../shared/petArt";

/** What every arcade game component receives from the game page. */
export interface ArcadeGameProps {
  /** The pet that plays (drawn in the game). A guest pet in practice mode. */
  pet: PetArtRecord;
  /** Strength perks of that pet (shields / extra lives). */
  perks: { extraLives: number; shields: number };
  /** Called once when the run ends. */
  onGameOver: (score: number) => void;
  /** HUD updates — called only when a value actually changes. */
  onHud: (hud: Hud) => void;
}

export interface Hud {
  score: number;
  lives?: number;
  shields?: number;
}

/** Decorative monster for the games catalog when the player has no pet yet (games themselves need a real pet). */
export const GUEST_PET: PetArtRecord = { seedHash: "guest-monster", rarity: "RARE", look: null, auraType: null, level: 15 };

/** Calls `onHud` only when the HUD values differ from the last call. */
export function hudReporter(onHud: (h: Hud) => void) {
  let last = "";
  return (h: Hud) => {
    const key = `${h.score}|${h.lives}|${h.shields}`;
    if (key !== last) {
      last = key;
      onHud(h);
    }
  };
}
