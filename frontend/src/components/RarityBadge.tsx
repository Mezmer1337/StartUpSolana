import type { FC, ReactNode } from "react";
import { RARITY_COLOR, RARITY_STARS } from "../types/pet";
import type { Rarity } from "../types/pet";

export const RarityBadge: FC<{ rarity: Rarity; className?: string; stars?: boolean }> = ({ rarity, className = "", stars = true }) => {
  const fancy = rarity === "LEGENDARY" || rarity === "MYTHIC";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-2 py-1 rounded-full border whitespace-nowrap ${fancy ? `rarity-badge-${rarity.toLowerCase()}` : ""} ${className}`}
      style={
        fancy
          ? undefined
          : { color: RARITY_COLOR[rarity], borderColor: `${RARITY_COLOR[rarity]}55`, background: `${RARITY_COLOR[rarity]}15` }
      }
    >
      {rarity}
      {stars && <span className="tracking-[-0.15em] opacity-90">{"★".repeat(RARITY_STARS[rarity])}</span>}
    </span>
  );
};

/**
 * Frame around a pet portrait whose intensity grows with rarity: plain for
 * Common → coloured glow (Uncommon/Rare) → pulsing glow with sparkles
 * (Epic) → shimmering gold border (Legendary) → spinning rainbow (Mythic).
 */
export const RarityFrame: FC<{ rarity: Rarity; children: ReactNode; className?: string; rounded?: string }> = ({
  rarity,
  children,
  className = "",
  rounded = "rounded-3xl",
}) => (
  <div className={`rarity-frame rarity-${rarity.toLowerCase()} ${rounded} ${className}`} style={{ ["--rc" as string]: RARITY_COLOR[rarity] }}>
    <div className={`rarity-frame-inner ${rounded}`}>
      {children}
      {(rarity === "EPIC" || rarity === "LEGENDARY" || rarity === "MYTHIC") && (
        <span className="rarity-sparkles" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  </div>
);
