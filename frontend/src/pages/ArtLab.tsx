import { useMemo, useState } from "react";
import type { FC } from "react";
import {
  AURA_SCHEMES,
  DEFAULT_ART_SET,
  describeLook,
  generatePalette,
  getArtSet,
  renderPetSvg,
  rngFromString,
  rollLook,
  svgToDataUri,
} from "../../../shared/petArt";
import type { ArtGrowthStage, PaletteTier, PetArtRecord, PetLook, PetMood } from "../../../shared/petArt";
import { TRAINING_GAMES } from "../../../shared/game/training";
import type { TrainingGameKey } from "../../../shared/game/training";
import { PowerGame } from "../components/training/PowerGame";
import { HopGame } from "../components/training/HopGame";
import { CatchGame } from "../components/training/CatchGame";
import { Button } from "../components/Button";
import { RarityBadge, RarityFrame } from "../components/RarityBadge";
import type { Rarity } from "../types/pet";

const RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
const STAGES: ArtGrowthStage[] = ["BABY", "YOUNG", "ADULT", "EVOLVED"];
const MOODS: PetMood[] = ["idle", "happy", "run", "sleep", "none"];
const LEVEL_FOR_STAGE: Record<ArtGrowthStage, number> = { BABY: 1, YOUNG: 5, ADULT: 15, EVOLVED: 30 };
const GAMES: Partial<Record<TrainingGameKey, typeof PowerGame>> = { POWER: PowerGame, HOP: HopGame, CATCH: CatchGame };

const Svg: FC<{ svg: string; size: number }> = ({ svg, size }) => (
  <img src={svgToDataUri(svg)} width={size} height={size} alt="" draggable={false} />
);

/**
 * Dev-only sandbox (/lab) for the artist and for testing: roll random
 * monsters, force palette tiers/moods/stages, see every variant of every
 * layer, and practise the training games (no server, no rewards).
 * With `npm run art:watch` running, saving in Inkscape updates this page live.
 */
export const ArtLab: FC = () => {
  const [seed, setSeed] = useState("lab-1");
  const [rarity, setRarity] = useState("COMMON");
  const [tier, setTier] = useState<PaletteTier | "auto">("auto");
  const [mood, setMood] = useState<PetMood>("idle");
  const [stage, setStage] = useState<ArtGrowthStage>("ADULT");
  const [aura, setAura] = useState<string>("none");
  const [game, setGame] = useState<TrainingGameKey | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);

  const set = getArtSet(DEFAULT_ART_SET);
  const look: PetLook = useMemo(() => {
    const base = rollLook(seed, rarity);
    return tier === "auto" ? base : { ...base, palette: generatePalette(tier, rngFromString(`${seed}:${tier}`)) };
  }, [seed, rarity, tier]);
  const auraType = aura === "none" ? null : aura;
  const pet: PetArtRecord = { seedHash: seed, rarity, look: JSON.stringify(look), auraType, level: LEVEL_FOR_STAGE[stage] };
  const reroll = () => setSeed(`lab-${Math.random().toString(36).slice(2)}`);
  const Game = game ? (GAMES[game] ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Art Lab</h1>
        <p className="text-sm text-gray-400">
          Dev sandbox · art set <b>{set.source}</b> · {set.slots.length} layers ·{" "}
          {set.slots.reduce((n, s) => n + s.variants.length, 0)} variants. Run{" "}
          <code className="text-purple-300">npm run art:watch</code> in backend/ and save in Inkscape — this page updates live.
        </p>
      </div>

      <div className="glass rounded-2xl p-6 grid md:grid-cols-[280px_1fr] gap-6">
        <div className="flex flex-col items-center gap-3">
          <RarityFrame rarity={rarity as Rarity}>
            <Svg svg={renderPetSvg({ look, auraType, stage }, { mood })} size={240} />
          </RarityFrame>
          <RarityBadge rarity={rarity as Rarity} />
          <Button onClick={reroll} className="w-full">
            🎲 Hatch another
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <Picker label="DNA rarity" value={rarity} options={RARITIES} onChange={setRarity} />
          <Picker label="Palette tier" value={tier} options={["auto", "common", "rare", "legendary"]} onChange={(v) => setTier(v as PaletteTier | "auto")} />
          <Picker label="Mood" value={mood} options={MOODS} onChange={(v) => setMood(v as PetMood)} />
          <Picker label="Aura" value={aura} options={["none", ...Object.keys(AURA_SCHEMES)]} onChange={setAura} />
          <Picker label="Stage" value={stage} options={STAGES} onChange={(v) => setStage(v as ArtGrowthStage)} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
            {describeLook(look).map((a) => (
              <div key={a.trait_type} className="flex justify-between border-b border-white/5 py-0.5">
                <span className="text-gray-400">{a.trait_type}</span>
                <span className="text-gray-200">{a.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <h2 className="font-bold text-white mb-1">Practice training</h2>
        <p className="text-sm text-gray-400 mb-4">Same games as on the pet page, but offline — no energy, no rewards.</p>
        {Game ? (
          <div className="max-w-2xl mx-auto">
            <Game
              key={seed + game}
              pet={pet}
              onFinish={(score) => {
                setLastScore(score);
                setGame(null);
              }}
            />
          </div>
        ) : (
          <div className="flex gap-3 flex-wrap items-center">
            {Object.values(TRAINING_GAMES)
              .filter((g) => g.category === "pet")
              .map((g) => (
              <Button key={g.key} variant="secondary" onClick={() => setGame(g.key)}>
                {g.emoji} {g.name}
              </Button>
            ))}
            {lastScore !== null && <span className="text-sm text-gray-300">Last score: {lastScore}</span>}
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-6">
        <h2 className="font-bold text-white mb-4">Every variant of every layer</h2>
        <div className="flex flex-col gap-4">
          {set.slots.map((slot) => (
            <div key={slot.key}>
              <div className="text-xs text-gray-400 mb-1">
                <b className="text-gray-200">{slot.label}</b> [{slot.key}] · {slot.variants.length} variant(s)
              </div>
              <div className="flex gap-2 flex-wrap">
                {slot.variants.map((v, i) => (
                  <figure key={v.id} className="glass rounded-lg p-1 text-center">
                    <Svg svg={renderPetSvg({ look: { ...look, parts: { ...look.parts, [slot.key]: v.id } }, auraType: null, stage: "ADULT" })} size={96} />
                    <figcaption className="text-[10px] text-gray-500 max-w-24 truncate">
                      #{i + 1} {v.label ?? v.id}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Picker: FC<{ label: string; value: string; options: string[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <div className="flex items-center gap-2 flex-wrap">
    <span className="text-gray-400 w-24">{label}</span>
    {options.map((o) => (
      <button
        key={o}
        onClick={() => onChange(o)}
        className={`px-2.5 py-1 rounded-lg border text-xs ${value === o ? "border-purple-400 bg-purple-500/20 text-white" : "border-white/10 text-gray-400"}`}
      >
        {o}
      </button>
    ))}
  </div>
);
