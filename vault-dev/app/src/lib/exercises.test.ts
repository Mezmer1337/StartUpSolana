// Тесты для заданий 1, 2, 10, 11, 12 (часть сайта).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { depositFee, previewDepositShares } from "./math";
import { kindOf, ownerDelta, snakeCase, summarize, type TokenBalanceLite } from "./history";
import { debounce, uniqueKeys } from "./live";
import { syncBlockedReason } from "../components/AdminPanel";
import type { VaultView } from "./vault";

describe("задание 1: комиссия 1% — та же формула, что deposit_fee в lib.rs", () => {
  it("1% с округлением вниз", () => {
    expect(depositFee(100_000_000n)).toBe(1_000_000n);
    expect(depositFee(1_000_000n)).toBe(10_000n);
    expect(depositFee(99n)).toBe(0n);
  });

  it("shares считаются от суммы без комиссии", () => {
    expect(previewDepositShares(100n * 10n ** 6n, 0n, 0n)).toBe(99n * 10n ** 6n); // первый депозит
    // курс 1.1: 110 токенов → 108.9 после комиссии → 99 shares
    expect(previewDepositShares(110_000_000n, 1100n, 1000n)).toBe(99_000_000n);
  });
});

const USER = "User1111111111111111111111111111111111111111";
const TOKEN = "TokenA11111111111111111111111111111111111111";
const SHARE = "Share111111111111111111111111111111111111111";
const bal = (mint: string, owner: string, amount: number): TokenBalanceLite => ({
  mint,
  owner,
  uiTokenAmount: { amount: String(amount) },
});

describe("задание 10: разбор транзакций для истории", () => {
  it("имя инструкции → вид операции (camelCase и snake_case)", () => {
    expect(snakeCase("withdrawAll")).toBe("withdraw_all");
    expect(kindOf(["deposit"])).toBe("deposit");
    expect(kindOf(["withdrawAll"])).toBe("withdraw_all");
    expect(kindOf(["withdraw_all"])).toBe("withdraw_all");
    expect(kindOf(["createUserCard", "deposit"])).toBe("deposit"); // карточка + депозит в одной транзакции
    expect(kindOf(["close_user_card"])).toBe("close_user_card");
    expect(kindOf([])).toBe("other");
  });

  it("изменение баланса считается только для своего mint и владельца", () => {
    const pre = [bal(TOKEN, USER, 1000), bal(TOKEN, "Other", 5), bal(SHARE, USER, 0)];
    const post = [bal(TOKEN, USER, 900), bal(TOKEN, "Other", 6), bal(SHARE, USER, 99)];
    expect(ownerDelta(pre, post, TOKEN, USER)).toBe(-100n);
    expect(ownerDelta(pre, post, SHARE, USER)).toBe(99n);
    // аккаунта shares до транзакции не было (создан в ней же)
    expect(ownerDelta([], [bal(SHARE, USER, 99)], SHARE, USER)).toBe(99n);
    expect(ownerDelta(null, undefined, SHARE, USER)).toBe(0n);
  });

  it("депозит: −100 токенов (с комиссией), +99 shares", () => {
    const item = summarize(
      {
        signature: "sig",
        blockTime: 1_700_000_000,
        failed: false,
        ixNames: ["deposit"],
        preTokenBalances: [bal(TOKEN, USER, 1000)],
        postTokenBalances: [bal(TOKEN, USER, 900), bal(SHARE, USER, 99)],
      },
      USER,
      TOKEN,
      SHARE
    );
    expect(item).toEqual({ signature: "sig", time: 1_700_000_000, kind: "deposit", ok: true, tokenDelta: -100n, shareDelta: 99n });
  });

  it("упавшая транзакция — без сумм", () => {
    const item = summarize(
      { signature: "s", blockTime: null, failed: true, ixNames: ["withdraw"], preTokenBalances: [], postTokenBalances: [] },
      USER,
      TOKEN,
      SHARE
    );
    expect(item.ok).toBe(false);
    expect(item.time).toBeNull();
    expect(item.tokenDelta).toBe(0n);
  });
});

describe("задание 11: когда sync_vault доступен", () => {
  const base: VaultView = {
    admin: PublicKey.default,
    decimals: 6,
    totalTokens: 0n,
    totalShares: 0n,
    inMarket: true,
    pairSet: true,
    positionOpen: false,
    vaultTokenAccountB: PublicKey.default,
    feeWallet: PublicKey.default,
    minDeposit: 1_000_000n,
    paused: false,
    totalFeesA: 0n,
    totalFeesB: 0n,
  };

  it("те же условия, что в контракте", () => {
    expect(syncBlockedReason(base, 0n)).toBeUndefined();
    expect(syncBlockedReason({ ...base, pairSet: false }, null)).toMatch(/add_pair_token/);
    expect(syncBlockedReason({ ...base, positionOpen: true }, 0n)).toMatch(/close_position/);
    expect(syncBlockedReason(base, 5n)).toMatch(/swap B → A/);
    expect(syncBlockedReason({ ...base, inMarket: false }, 0n)).toMatch(/обычном режиме/);
  });
});

describe("задание 12: подписки", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounce: пачка изменений → один refresh", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d.call();
    d.call();
    vi.advanceTimersByTime(200);
    d.call();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("debounce: cancel отменяет ожидающий вызов", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("одинаковые адреса подписываем один раз", () => {
    const a = PublicKey.default;
    const b = new PublicKey("11111111111111111111111111111112");
    expect(uniqueKeys([a, b, a]).map((k) => k.toBase58())).toEqual([a.toBase58(), b.toBase58()]);
  });
});
