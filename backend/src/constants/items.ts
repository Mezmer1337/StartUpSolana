export interface ItemDefinition {
  key: string;
  name: string;
  description: string;
  /** MYSTIC = SOL-only items that change how a pet looks (horns, tail, aura). */
  category: "FOOD" | "TOY" | "POTION" | "TRAINING" | "COSMETIC" | "MYSTIC";
  rarity: "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
  icon: string;
}

/** Shop prices. null = not sold for that currency (MYSTIC items are SOL-only). */
export interface ItemPrice {
  petCoins: number | null;
  sol: number | null;
}

export const ITEM_CATALOG: ItemDefinition[] = [
  {
    key: "kibble",
    name: "Basic Kibble",
    description: "Restores 15 Hunger instantly when used.",
    category: "FOOD",
    rarity: "COMMON",
    icon: "🍖",
  },
  {
    key: "premium_meal",
    name: "Premium Meal",
    description: "Restores 40 Hunger and a small amount of XP.",
    category: "FOOD",
    rarity: "RARE",
    icon: "🍱",
  },
  {
    key: "chew_toy",
    name: "Chew Toy",
    description: "Boosts Happiness by 20 when used.",
    category: "TOY",
    rarity: "COMMON",
    icon: "🧸",
  },
  {
    key: "energy_potion",
    name: "Energy Potion",
    description: "Instantly restores 30 Energy.",
    category: "POTION",
    rarity: "UNCOMMON",
    icon: "🧪",
  },
  {
    key: "health_potion",
    name: "Health Potion",
    description: "Restores 25 Health.",
    category: "POTION",
    rarity: "UNCOMMON",
    icon: "💊",
  },
  {
    key: "training_weights",
    name: "Training Weights",
    description: "Grants +2 Strength when used (no Energy cost).",
    category: "TRAINING",
    rarity: "RARE",
    icon: "🏋️",
  },
  {
    key: "speed_boots",
    name: "Speed Boots",
    description: "Grants +2 Speed when used (no Energy cost).",
    category: "TRAINING",
    rarity: "RARE",
    icon: "👟",
  },
  {
    key: "party_hat",
    name: "Party Hat",
    description: "An equippable cosmetic accessory. Purely for style.",
    category: "COSMETIC",
    rarity: "EPIC",
    icon: "🎉",
  },
  {
    key: "sunglasses",
    name: "Cool Shades",
    description: "An equippable cosmetic accessory. Purely for style.",
    category: "COSMETIC",
    rarity: "UNCOMMON",
    icon: "🕶️",
  },
  {
    key: "crown",
    name: "Golden Crown",
    description: "An equippable cosmetic accessory. Purely for style.",
    category: "COSMETIC",
    rarity: "LEGENDARY",
    icon: "👑",
  },
  {
    key: "bandana",
    name: "Bandana",
    description: "An equippable cosmetic accessory. Purely for style.",
    category: "COSMETIC",
    rarity: "COMMON",
    icon: "🧣",
  },
  // ---- Progression items (shop) ----
  {
    key: "lucky_clover",
    name: "Lucky Clover",
    description: "Grants +2 Luck when used.",
    category: "TRAINING",
    rarity: "RARE",
    icon: "🍀",
  },
  {
    key: "xp_scroll",
    name: "XP Scroll",
    description: "Grants 50 XP instantly — may level your pet up.",
    category: "TRAINING",
    rarity: "EPIC",
    icon: "📜",
  },
  {
    key: "mega_protein",
    name: "Mega Protein",
    description: "Grants +5 Strength and refills 20 Energy.",
    category: "TRAINING",
    rarity: "EPIC",
    icon: "💪",
  },
  // ---- Mystic items: SOL only, change the pet's look ----
  {
    key: "horn_elixir",
    name: "Horn Elixir",
    description: "Your pet grows a random pair of horns (or swaps its horns for a different kind).",
    category: "MYSTIC",
    rarity: "LEGENDARY",
    icon: "🦄",
  },
  {
    key: "tail_charm",
    name: "Tail Charm",
    description: "Your pet grows a random tail (or swaps its tail for a different kind).",
    category: "MYSTIC",
    rarity: "LEGENDARY",
    icon: "🪄",
  },
  {
    key: "aura_crystal",
    name: "Aura Crystal",
    description: "Awakens a random elemental aura around your pet (a different one if it already has one).",
    category: "MYSTIC",
    rarity: "LEGENDARY",
    icon: "🔮",
  },
];

/**
 * Shop price list (backend/src/services/shopService.ts). PetCoins are earned
 * in games, quests and daily rewards; SOL is paid on-chain to the treasury.
 * Mystic items are SOL-only by design.
 */
export const ITEM_PRICES: Record<string, ItemPrice> = {
  kibble: { petCoins: 20, sol: 0.005 },
  premium_meal: { petCoins: 60, sol: 0.015 },
  chew_toy: { petCoins: 25, sol: 0.006 },
  energy_potion: { petCoins: 40, sol: 0.01 },
  health_potion: { petCoins: 40, sol: 0.01 },
  training_weights: { petCoins: 120, sol: 0.03 },
  speed_boots: { petCoins: 120, sol: 0.03 },
  lucky_clover: { petCoins: 120, sol: 0.03 },
  xp_scroll: { petCoins: 150, sol: 0.04 },
  mega_protein: { petCoins: 300, sol: 0.07 },
  party_hat: { petCoins: 150, sol: 0.04 },
  sunglasses: { petCoins: 100, sol: 0.025 },
  crown: { petCoins: 500, sol: 0.12 },
  bandana: { petCoins: 60, sol: 0.015 },
  horn_elixir: { petCoins: null, sol: 0.05 },
  tail_charm: { petCoins: null, sol: 0.05 },
  aura_crystal: { petCoins: null, sol: 0.15 },
};

export const ACCESSORY_KEYS = ITEM_CATALOG.filter((i) => i.category === "COSMETIC").map((i) => i.key);

export const DAILY_REWARD_ITEM_POOL = ["kibble", "chew_toy", "energy_potion", "training_weights"];
