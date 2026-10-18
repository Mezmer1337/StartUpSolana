import { describe, expect, it } from "vitest";
import { computeSaleBreakdown, computeSaleLamports } from "../src/services/marketplaceService";

describe("marketplace — on-chain payment split", () => {
  it("splits the price into seller share + 5% fees, in whole lamports that add up exactly", () => {
    for (const price of [0.1, 0.5, 0.1234, 1, 2.75, 0.000001]) {
      const { total, sellerLamports, treasuryLamports } = computeSaleLamports(price);
      expect(total).toBe(Math.round(price * 1e9));
      expect(sellerLamports + treasuryLamports).toBe(total);
      expect(Number.isInteger(sellerLamports) && Number.isInteger(treasuryLamports)).toBe(true);
      expect(treasuryLamports).toBe(Math.floor(total * 0.05));
    }
  });

  it("matches the SOL breakdown shown to the buyer", () => {
    const sol = computeSaleBreakdown(0.5);
    const lam = computeSaleLamports(0.5);
    expect(lam.sellerLamports / 1e9).toBeCloseTo(sol.sellerProceedsSol, 9);
    expect(lam.treasuryLamports / 1e9).toBeCloseTo(sol.platformFeeSol + sol.royaltySol, 9);
  });
});
