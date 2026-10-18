import { describe, expect, it } from "vitest";
import { ITEM_CATALOG, ITEM_PRICES } from "../src/constants/items";
import { solOrderLamports } from "../src/services/shopService";

describe("shop — price list", () => {
  it("prices every catalog item, and every price belongs to a real item", () => {
    for (const item of ITEM_CATALOG) expect(ITEM_PRICES[item.key], item.key).toBeDefined();
    for (const key of Object.keys(ITEM_PRICES)) expect(ITEM_CATALOG.some((i) => i.key === key), key).toBe(true);
  });

  it("Mystic items (horns / tail / aura) are SOL-only; everything else also sells for PetCoins", () => {
    for (const item of ITEM_CATALOG) {
      const price = ITEM_PRICES[item.key];
      expect(price.sol, item.key).toBeGreaterThan(0);
      if (item.category === "MYSTIC") expect(price.petCoins, item.key).toBeNull();
      else expect(price.petCoins, item.key).toBeGreaterThan(0);
    }
    expect(ITEM_CATALOG.filter((i) => i.category === "MYSTIC").map((i) => i.key).sort()).toEqual(["aura_crystal", "horn_elixir", "tail_charm"]);
  });

  it("SOL orders are whole lamports", () => {
    expect(solOrderLamports("horn_elixir", 1)).toBe(50_000_000);
    expect(solOrderLamports("aura_crystal", 2)).toBe(300_000_000);
    expect(Number.isInteger(solOrderLamports("chew_toy", 3))).toBe(true);
  });
});
