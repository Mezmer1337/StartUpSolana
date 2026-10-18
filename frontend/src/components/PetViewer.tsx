import { useMemo } from "react";
import type { FC } from "react";
import { renderPetSvgFromRecord, svgToDataUri } from "../../../shared/petArt";
import type { PetArtRecord, PetMood } from "../../../shared/petArt";
import type { Pet } from "../types/pet";

const ACCESSORY_EMOJI: Record<string, string> = {
  party_hat: "🎉",
  sunglasses: "🕶️",
  crown: "👑",
  bandana: "🧣",
};

/**
 * Draws a pet from its raw DNA columns with the shared part-based renderer
 * (shared/petArt, compiled from the artist's Inkscape file) — the exact same picture the backend bakes into the NFT.
 * Rendered as an <img> data URI so each pet's SVG ids stay isolated.
 */
export const PetPortrait: FC<{ art: PetArtRecord; size?: number; className?: string; mood?: PetMood }> = ({
  art,
  size = 160,
  className,
  mood = "idle",
}) => {
  // Depend on the primitive columns (not the object) so a refetched pet
  // with identical DNA doesn't re-render the SVG.
  const { seedHash, rarity, look, auraType, level } = art;
  const src = useMemo(
    () => svgToDataUri(renderPetSvgFromRecord({ seedHash, rarity, look, auraType, level }, { mood })),
    [seedHash, rarity, look, auraType, level, mood],
  );
  return <img src={src} width={size} height={size} alt="" draggable={false} className={className} />;
};

/**
 * In-game pet view: animated portrait + equipped accessory overlay. A pet
 * with almost no energy naps unless the caller forces a mood.
 */
export const PetViewer: FC<{ pet: Pet; size?: number; mood?: PetMood }> = ({ pet, size = 160, mood }) => (
  <div className="relative shrink-0" style={{ width: size, height: size }}>
    <PetPortrait art={pet} size={size} mood={mood ?? (pet.energy < 15 ? "sleep" : "idle")} />
    {pet.equippedAccessoryKey && ACCESSORY_EMOJI[pet.equippedAccessoryKey] && (
      <span className="absolute" style={{ fontSize: size * 0.22, top: size * 0.02, right: size * 0.06 }}>
        {ACCESSORY_EMOJI[pet.equippedAccessoryKey]}
      </span>
    )}
  </div>
);
