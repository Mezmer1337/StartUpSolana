// Raydium in devnet, course tasks 11-13: pools, swaps, concentrated-liquidity positions.
//
//   npm run raydium -- tokens                                  create test tokens FOOD and GEM, mint 1 000 000 of each
//   npm run raydium -- configs                                 fee tiers of devnet CPMM and CLMM
//   npm run raydium -- cpmm-create --food 1000 --gem 2000      CPMM (constant product, x*y=k) pool; costs 0.15 SOL fee
//   npm run raydium -- cpmm-pool                               reserves and price of the CPMM pool
//   npm run raydium -- clmm-create --price 2 [--config 0]      CLMM pool, starting at 2 GEM per FOOD
//   npm run raydium -- clmm-pool                               price, current tick, active liquidity
//   npm run raydium -- swap --in FOOD --amount 10 [--slippage 0.5] [--min-out 25]   swap via the CLMM pool with a min-out guard
//   npm run raydium -- open --lower 1.8 --upper 2.2 --amount 100 [--token FOOD]   open a position in a price range
//   npm run raydium -- positions                               ranges, in/out of range, value and uncollected fees
//   npm run raydium -- collect --nft <mint>                    collect fees, liquidity stays
//   npm run raydium -- close --nft <mint>                      withdraw everything, collect fees, burn the position NFT
//   npm run raydium -- rebalance --nft <mint> [--width 10] [--force]   out of range? close and reopen around the price
//
// Prices are always GEM per 1 FOOD. --slippage is in percent. SOLANA_RPC_URL must point at devnet.

import { TxVersion, PoolUtils, type ApiV3PoolInfoConcentratedItem, type ClmmPositionLayout } from "@raydium-io/raydium-sdk-v2";
import { createAssociatedTokenAccountIdempotent, createMint, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { connection, explorerAddress, explorerTx, loadKeypair, parseArgs, RPC_URL } from "./common";
import {
  CLMM_PROGRAM,
  CPMM_FEE_ACCOUNT,
  CPMM_PROGRAM,
  TEST_TOKENS,
  apiToken,
  clmmConfigs,
  cpmmConfigs,
  foodPrice,
  fromUnits,
  loadRaydium,
  loadState,
  pendingFees,
  positionAmounts,
  rangeToTicks,
  saveState,
  tickPrice,
  toPoolPrice,
  toUnits,
  tokenBalance,
  type TestSymbol,
} from "./raydium-core";

const { command, option } = parseArgs();
const conn = connection();
const owner = loadKeypair();
const txVersion = TxVersion.V0;
const state = loadState();
const slippage = Number(option("slippage") ?? 0.5) / 100;

function tokens() {
  if (!state.tokens) throw new Error("No test tokens yet: run `npm run raydium -- tokens`");
  return { FOOD: state.tokens.FOOD, GEM: state.tokens.GEM };
}

function clmmPoolId() {
  if (!state.clmmPool) throw new Error("No CLMM pool yet: run `npm run raydium -- clmm-create`");
  return state.clmmPool;
}

function symbolOption(name: string): TestSymbol {
  const symbol = (option(name) || "FOOD").toUpperCase();
  if (!(symbol in TEST_TOKENS)) throw new Error(`--${name} must be FOOD or GEM, got "${symbol}"`);
  return symbol as TestSymbol;
}

const symbolOf = (pool: ApiV3PoolInfoConcentratedItem, side: "A" | "B") =>
  (pool[side === "A" ? "mintA" : "mintB"].address === tokens().FOOD ? "FOOD" : "GEM") as TestSymbol;

/** `raw` plus the slippage allowance, rounded up: the most we agree to pay. */
const plusSlippage = (raw: BN) => raw.muln(Math.round((1 + slippage) * 10_000)).divn(10_000).addn(1);

const fmt = (raw: BN, decimals = 6) => fromUnits(raw, decimals).toDecimalPlaces(6).toString();

async function balances() {
  const t = tokens();
  const [food, gem] = await Promise.all([tokenBalance(conn, new PublicKey(t.FOOD), owner.publicKey), tokenBalance(conn, new PublicKey(t.GEM), owner.publicKey)]);
  return { FOOD: food, GEM: gem };
}

async function main() {
  console.log(`RPC ${RPC_URL} · wallet ${owner.publicKey.toBase58()}\n`);

  if (command === "tokens") {
    if (state.tokens) {
      console.log(`Already created: FOOD ${state.tokens.FOOD}, GEM ${state.tokens.GEM}`);
      return;
    }
    const created = {} as Record<TestSymbol, string>;
    for (const symbol of Object.keys(TEST_TOKENS) as TestSymbol[]) {
      const mint = await createMint(conn, owner, owner.publicKey, null, TEST_TOKENS[symbol].decimals, undefined, { commitment: "confirmed" });
      const ata = await createAssociatedTokenAccountIdempotent(conn, owner, mint, owner.publicKey, { commitment: "confirmed" });
      await mintTo(conn, owner, mint, ata, owner, 1_000_000n * 10n ** BigInt(TEST_TOKENS[symbol].decimals), [], { commitment: "confirmed" });
      created[symbol] = mint.toBase58();
      console.log(`${symbol.padEnd(4)} ${mint.toBase58()}  1 000 000 minted · ${explorerAddress(mint)}`);
    }
    saveState({ ...state, tokens: created });
    return;
  }

  if (command === "configs") {
    console.log("CPMM fee tiers (devnet):");
    for (const c of await cpmmConfigs(conn)) {
      console.log(`  #${c.index}  ${c.id}  trade fee ${c.tradeFeeRate / 10_000}%  create fee ${Number(c.createPoolFee) / 1e9} SOL${c.disabled ? "  (disabled)" : ""}`);
    }
    console.log("CLMM fee tiers (devnet):");
    for (const c of await clmmConfigs(conn)) {
      console.log(`  #${c.index}  ${c.id.toBase58()}  trade fee ${c.tradeFeeRate / 10_000}%  tick spacing ${c.tickSpacing}`);
    }
    return;
  }

  const raydium = await loadRaydium(conn, owner);
  const t = tokens();

  switch (command) {
    // ---------------- Task 11: pools ----------------
    case "cpmm-create": {
      const config = (await cpmmConfigs(conn)).find((c) => c.index === Number(option("config") ?? 0));
      if (!config) throw new Error("Unknown CPMM config index, see `configs`");
      const { execute, extInfo } = await raydium.cpmm.createPool({
        programId: CPMM_PROGRAM,
        poolFeeAccount: CPMM_FEE_ACCOUNT,
        mintA: apiToken(t.FOOD, "FOOD"),
        mintB: apiToken(t.GEM, "GEM"),
        mintAAmount: toUnits(option("food") ?? "1000", 6),
        mintBAmount: toUnits(option("gem") ?? "2000", 6),
        startTime: new BN(0),
        feeConfig: config,
        associatedOnly: false,
        ownerInfo: { useSOLBalance: true },
        txVersion,
      });
      const { txId } = await execute({ sendAndConfirm: true });
      saveState({ ...state, cpmmPool: extInfo.address.poolId.toBase58() });
      console.log(`CPMM pool ${extInfo.address.poolId.toBase58()}  (LP mint ${extInfo.address.lpMint.toBase58()})`);
      console.log(`tx ${explorerTx(txId)}`);
      return;
    }
    case "cpmm-pool": {
      if (!state.cpmmPool) throw new Error("No CPMM pool yet: run `npm run raydium -- cpmm-create`");
      const { poolInfo, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(state.cpmmPool);
      const [a, b] = [rpcData.baseReserve, rpcData.quoteReserve];
      const symA = poolInfo.mintA.address === t.FOOD ? "FOOD" : "GEM";
      const symB = symA === "FOOD" ? "GEM" : "FOOD";
      console.log(`pool      ${state.cpmmPool}   (CPMM, fee ${poolInfo.feeRate / 10_000}%)`);
      console.log(`reserves  ${fmt(a)} ${symA} · ${fmt(b)} ${symB}`);
      console.log(`k = x·y   ${fromUnits(a, 6).mul(fromUnits(b, 6)).toFixed(2)}`);
      console.log(`price     ${foodPrice(poolInfo, rpcData.poolPrice, t.FOOD).toFixed(6)} GEM per FOOD`);
      console.log(`LP supply ${fmt(rpcData.lpAmount)}`);
      return;
    }
    case "clmm-create": {
      const config = (await clmmConfigs(conn)).find((c) => c.index === Number(option("config") ?? 0));
      if (!config) throw new Error("Unknown CLMM config index, see `configs`");
      const { execute, extInfo } = await raydium.clmm.createPool({
        programId: CLMM_PROGRAM,
        mint1: apiToken(t.FOOD, "FOOD"),
        mint2: apiToken(t.GEM, "GEM"),
        ammConfig: config,
        initialPrice: new Decimal(option("price") ?? "2"), // mint2 per mint1: GEM per FOOD
        txVersion,
      });
      const { txId } = await execute({ sendAndConfirm: true });
      saveState({ ...state, clmmPool: extInfo.address.id });
      console.log(`CLMM pool ${extInfo.address.id}  fee ${config.tradeFeeRate / 10_000}%  tick spacing ${config.tickSpacing}`);
      console.log(`tx ${explorerTx(txId)}`);
      return;
    }
    case "clmm-pool": {
      const { poolInfo, computePoolInfo } = await raydium.clmm.getPoolInfoFromRpc(clmmPoolId());
      const [vaultA, vaultB] = await Promise.all([
        conn.getTokenAccountBalance(computePoolInfo.vaultA),
        conn.getTokenAccountBalance(computePoolInfo.vaultB),
      ]);
      console.log(`pool       ${poolInfo.id}   (CLMM, fee ${poolInfo.feeRate / 10_000}%, tick spacing ${poolInfo.config.tickSpacing})`);
      console.log(`mints      A = ${symbolOf(poolInfo, "A")} ${poolInfo.mintA.address}, B = ${symbolOf(poolInfo, "B")} ${poolInfo.mintB.address}`);
      console.log(`price      ${foodPrice(poolInfo, computePoolInfo.currentPrice, t.FOOD).toFixed(6)} GEM per FOOD   (pool: ${computePoolInfo.currentPrice.toFixed(6)} B per A)`);
      console.log(`tick       ${computePoolInfo.tickCurrent}   sqrtPriceX64 ${computePoolInfo.sqrtPriceX64.toString()}`);
      console.log(`liquidity  ${computePoolInfo.liquidity.toString()}  (active at the current price only)`);
      console.log(`vaults     ${vaultA.value.uiAmountString} ${symbolOf(poolInfo, "A")} · ${vaultB.value.uiAmountString} ${symbolOf(poolInfo, "B")}`);
      return;
    }

    // ---------------- Task 12: swap with slippage ----------------
    case "swap": {
      const inSymbol = symbolOption("in");
      // --min-out overrides the computed minimum: set it above the quote to watch the program refuse.
      const minOut = option("min-out") ? toUnits(option("min-out")!, 6) : undefined;
      const txId = await swap(raydium, inSymbol, toUnits(option("amount") ?? "10", 6), minOut);
      console.log(`tx ${explorerTx(txId)}`);
      return;
    }

    // ---------------- Task 13: positions ----------------
    case "open": {
      const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(clmmPoolId());
      const lower = toPoolPrice(poolInfo, option("lower") ?? "1.8", t.FOOD);
      const upper = toPoolPrice(poolInfo, option("upper") ?? "2.2", t.FOOD);
      const symbol = symbolOption("token");
      const txId = await openPosition(raydium, poolInfo, poolKeys, lower, upper, symbol, toUnits(option("amount") ?? "100", 6));
      console.log(`tx ${explorerTx(txId)}\n`);
      await listPositions(raydium);
      return;
    }
    case "positions":
      await listPositions(raydium);
      return;
    case "collect": {
      // Raydium has no separate "collect" instruction: decrease_liquidity with 0 liquidity settles the fees
      // earned so far and transfers them to the owner.
      const { position, poolInfo, poolKeys } = await findPosition(raydium);
      const fees = await pendingFees(raydium, position);
      const { execute } = await raydium.clmm.decreaseLiquidity({
        poolInfo,
        poolKeys,
        ownerPosition: position,
        ownerInfo: { useSOLBalance: true, closePosition: false },
        liquidity: new BN(0),
        amountMinA: new BN(0),
        amountMinB: new BN(0),
        txVersion,
      });
      const { txId } = await execute({ sendAndConfirm: true });
      console.log(`collected ~${fmt(fees.tokenFeeAmountA)} ${symbolOf(poolInfo, "A")} + ~${fmt(fees.tokenFeeAmountB)} ${symbolOf(poolInfo, "B")}`);
      console.log(`tx ${explorerTx(txId)}`);
      return;
    }
    case "close": {
      const { position, poolInfo, poolKeys } = await findPosition(raydium);
      const txId = await closePosition(raydium, poolInfo, poolKeys, position);
      console.log(`position ${position.nftMint.toBase58()} closed, NFT burned`);
      console.log(`tx ${explorerTx(txId)}`);
      return;
    }
    case "rebalance": {
      const { position, poolInfo, poolKeys } = await findPosition(raydium);
      const { computePoolInfo } = await raydium.clmm.getPoolInfoFromRpc(poolInfo.id);
      const tick = computePoolInfo.tickCurrent;
      const inRange = tick >= position.tickLower && tick < position.tickUpper;
      const price = foodPrice(poolInfo, computePoolInfo.currentPrice, t.FOOD);
      console.log(`price ${price.toFixed(6)} GEM/FOOD, range ${rangeText(poolInfo, position)} -> ${inRange ? "IN range" : "OUT of range"}`);
      if (inRange && option("force") === undefined) {
        console.log("Nothing to do (pass --force to recenter anyway).");
        return;
      }

      // 1. Close: all liquidity + fees come back to the wallet.
      const before = await balances();
      console.log(`close  ${explorerTx(await closePosition(raydium, poolInfo, poolKeys, position))}`);
      const after = await balances();
      const got = { FOOD: after.FOOD.sub(before.FOOD), GEM: after.GEM.sub(before.GEM) };
      console.log(`       got back ${fmt(got.FOOD)} FOOD + ${fmt(got.GEM)} GEM`);

      // 2. Out of range, the position came back as one token only (the price ran through it and sold the
      //    other side). A centered range needs both, so swap half of the surplus value.
      const surplus = fromUnits(got.FOOD, 6).mul(price).sub(fromUnits(got.GEM, 6)).div(2); // in GEM
      if (surplus.abs().gt(fromUnits(got.GEM, 6).add(fromUnits(got.FOOD, 6).mul(price)).mul(0.05))) {
        const [inSymbol, amount] = surplus.gt(0) ? (["FOOD", surplus.div(price)] as const) : (["GEM", surplus.neg()] as const);
        const before2 = await balances();
        console.log(`swap   ${explorerTx(await swap(raydium, inSymbol, toUnits(amount.toFixed(6, Decimal.ROUND_DOWN), 6)))}`);
        const after2 = await balances();
        got.FOOD = got.FOOD.add(after2.FOOD.sub(before2.FOOD));
        got.GEM = got.GEM.add(after2.GEM.sub(before2.GEM));
        console.log(`       now ${fmt(got.FOOD)} FOOD + ${fmt(got.GEM)} GEM`);
      }

      // 3. Reopen: ±width% around the current price, as much as those tokens allow.
      const width = new Decimal(option("width") ?? "10").div(100);
      const fresh = await raydium.clmm.getPoolInfoFromRpc(poolInfo.id);
      const freshPrice = foodPrice(fresh.poolInfo, fresh.computePoolInfo.currentPrice, t.FOOD);
      const lower = toPoolPrice(fresh.poolInfo, freshPrice.mul(new Decimal(1).sub(width)), t.FOOD);
      const upper = toPoolPrice(fresh.poolInfo, freshPrice.mul(new Decimal(1).add(width)), t.FOOD);
      const txId = await openWithBoth(raydium, fresh.poolInfo, fresh.poolKeys, lower, upper, got);
      console.log(`open   ${explorerTx(txId)}\n`);
      await listPositions(raydium);
      return;
    }
    default:
      console.log("Usage: npm run raydium -- tokens|configs|cpmm-create|cpmm-pool|clmm-create|clmm-pool|swap|open|positions|collect|close|rebalance");
      process.exitCode = 1;
  }
}

type Ray = Awaited<ReturnType<typeof loadRaydium>>;
type PoolKeys = Awaited<ReturnType<Ray["clmm"]["getPoolInfoFromRpc"]>>["poolKeys"];

function rangeText(pool: ApiV3PoolInfoConcentratedItem, p: Pick<ClmmPositionLayout, "tickLower" | "tickUpper">) {
  const a = foodPrice(pool, tickPrice(pool, p.tickLower), tokens().FOOD);
  const b = foodPrice(pool, tickPrice(pool, p.tickUpper), tokens().FOOD);
  const [lo, hi] = a.lt(b) ? [a, b] : [b, a];
  return `${lo.toFixed(4)}–${hi.toFixed(4)}`;
}

async function findPosition(raydium: Ray) {
  const nft = option("nft");
  const all = (await raydium.clmm.getOwnerPositionInfo({ programId: CLMM_PROGRAM })).filter((p) => p.poolId.toBase58() === clmmPoolId());
  const position = nft ? all.find((p) => p.nftMint.toBase58() === nft) : all.length === 1 ? all[0] : undefined;
  if (!position) throw new Error(nft ? `No position with NFT ${nft}` : `Pass --nft <mint> (${all.length} positions, see \`positions\`)`);
  const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(clmmPoolId());
  return { position, poolInfo, poolKeys };
}

async function listPositions(raydium: Ray) {
  // Positions are found through the wallet's NFTs; the SDK caches token accounts, so refresh after a tx.
  await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true });
  const { poolInfo, computePoolInfo } = await raydium.clmm.getPoolInfoFromRpc(clmmPoolId());
  const positions = (await raydium.clmm.getOwnerPositionInfo({ programId: CLMM_PROGRAM })).filter((p) => p.poolId.toBase58() === poolInfo.id);
  console.log(`price ${foodPrice(poolInfo, computePoolInfo.currentPrice, tokens().FOOD).toFixed(6)} GEM per FOOD (tick ${computePoolInfo.tickCurrent})`);
  if (!positions.length) console.log("No positions in this pool.");
  for (const p of positions) {
    const inRange = computePoolInfo.tickCurrent >= p.tickLower && computePoolInfo.tickCurrent < p.tickUpper;
    const value = await positionAmounts(raydium, poolInfo, p, 0);
    const fees = await pendingFees(raydium, p);
    console.log(`\nNFT    ${p.nftMint.toBase58()}`);
    console.log(`range  ${rangeText(poolInfo, p)} GEM/FOOD  (ticks ${p.tickLower}..${p.tickUpper})  ${inRange ? "IN range: earning fees" : "OUT of range: no fees"}`);
    console.log(`holds  ${fmt(value.amountA)} ${symbolOf(poolInfo, "A")} + ${fmt(value.amountB)} ${symbolOf(poolInfo, "B")}   liquidity ${p.liquidity.toString()}`);
    console.log(`fees   ${fmt(fees.tokenFeeAmountA)} ${symbolOf(poolInfo, "A")} + ${fmt(fees.tokenFeeAmountB)} ${symbolOf(poolInfo, "B")} uncollected`);
  }
}

/**
 * Exact-in swap through the CLMM pool. The quote walks the pool's tick arrays off-chain (same math as the
 * program); `amountOutMin` = quote minus slippage goes into the instruction, and the program reverts with
 * TooLittleOutputReceived if the pool moved against us before the transaction landed.
 */
async function swap(raydium: Ray, inSymbol: TestSymbol, amountIn: BN, minOutOverride?: BN) {
  const t = tokens();
  const { poolInfo, poolKeys, computePoolInfo, tickData } = await raydium.clmm.getPoolInfoFromRpc(clmmPoolId());
  const baseIn = poolInfo.mintA.address === t[inSymbol];
  const quote = PoolUtils.computeAmountOutFormat({
    poolInfo: computePoolInfo,
    tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
    tickArrayCache: tickData[poolInfo.id],
    amountIn,
    tokenOut: poolInfo[baseIn ? "mintB" : "mintA"],
    slippage,
    epochInfo: await raydium.fetchEpochInfo(),
    blockTimestamp: Math.floor(Date.now() / 1000),
  });
  const outSymbol = inSymbol === "FOOD" ? "GEM" : "FOOD";
  const [inAmount, outAmount] = [fromUnits(amountIn, 6), new Decimal(quote.amountOut.amount.toExact())];
  const execution = inSymbol === "FOOD" ? outAmount.div(inAmount) : inAmount.div(outAmount);
  console.log(`quote     ${fmt(amountIn)} ${inSymbol} -> ${quote.amountOut.amount.toExact()} ${outSymbol}`);
  console.log(`min out   ${quote.minAmountOut.amount.toExact()} ${outSymbol}   (slippage ${slippage * 100}%: the program rejects anything less)`);
  console.log(`fee       ${quote.fee.toExact()} ${inSymbol}   price impact ${quote.priceImpact.toSignificant(4)}%`);
  console.log(`price     pool ${foodPrice(poolInfo, computePoolInfo.currentPrice, t.FOOD).toFixed(6)}, this swap ${execution.toFixed(6)} GEM per FOOD (fee + moving along the curve)`);

  const before = await balances();
  const { execute } = await raydium.clmm.swap({
    poolInfo,
    poolKeys,
    inputMint: t[inSymbol],
    amountIn,
    amountOutMin: minOutOverride ?? quote.minAmountOut.amount.raw,
    observationId: computePoolInfo.observationId,
    ownerInfo: { useSOLBalance: true },
    remainingAccounts: quote.remainingAccounts,
    txVersion,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const after = await balances();
  const { computePoolInfo: poolAfter } = await raydium.clmm.getPoolInfoFromRpc(poolInfo.id);
  console.log(`received  ${fmt(after[outSymbol].sub(before[outSymbol]))} ${outSymbol} (paid ${fmt(before[inSymbol].sub(after[inSymbol]))} ${inSymbol})`);
  console.log(`pool now  ${foodPrice(poolInfo, poolAfter.currentPrice, t.FOOD).toFixed(6)} GEM per FOOD (tick ${poolAfter.tickCurrent})`);
  return txId;
}

/** Opens a position putting `amount` of `symbol` in; the SDK computes how much of the other token it needs. */
async function openPosition(
  raydium: Ray,
  poolInfo: ApiV3PoolInfoConcentratedItem,
  poolKeys: PoolKeys,
  lower: Decimal,
  upper: Decimal,
  symbol: TestSymbol,
  amount: BN,
) {
  const { tickLower, tickUpper } = rangeToTicks(poolInfo, lower, upper);
  const inputA = poolInfo.mintA.address === tokens()[symbol];
  const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    inputA,
    tickLower,
    tickUpper,
    amount,
    slippage: 0,
    add: true,
    epochInfo: await raydium.fetchEpochInfo(),
    amountHasFee: true,
  });
  if (res.liquidity.isZero()) {
    // A range entirely above the price holds only A; entirely below, only B.
    throw new Error(`This range needs no ${symbol} at the current price: pass --token ${symbol === "FOOD" ? "GEM" : "FOOD"}`);
  }
  const other = inputA ? res.amountSlippageB.amount : res.amountSlippageA.amount;
  const otherSymbol = symbol === "FOOD" ? "GEM" : "FOOD";
  console.log(`open   ${rangeText(poolInfo, { tickLower, tickUpper })} GEM/FOOD: ${fmt(amount)} ${symbol} + up to ${fmt(plusSlippage(other))} ${otherSymbol}`);
  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    tickLower,
    tickUpper,
    base: inputA ? "MintA" : "MintB",
    baseAmount: amount,
    otherAmountMax: plusSlippage(other),
    ownerInfo: { useSOLBalance: true },
    txVersion,
    computeBudgetConfig: { units: 600_000, microLamports: 10_000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`NFT    ${extInfo.nftMint.toBase58()} (the position is this NFT: whoever holds it owns the liquidity)`);
  return txId;
}

/** Puts as much of `available` as fits into the range: whichever token runs out first sets the size. */
async function openWithBoth(
  raydium: Ray,
  poolInfo: ApiV3PoolInfoConcentratedItem,
  poolKeys: PoolKeys,
  lower: Decimal,
  upper: Decimal,
  available: Record<TestSymbol, BN>,
) {
  const { tickLower, tickUpper } = rangeToTicks(poolInfo, lower, upper);
  const epochInfo = await raydium.fetchEpochInfo();
  // Keep a little headroom for slippage on the other side.
  const budget = (s: TestSymbol) => available[s].muln(1_000).divn(1_000 + Math.ceil(slippage * 1_000) + 1);
  for (const symbol of ["FOOD", "GEM"] as TestSymbol[]) {
    if (available[symbol].isZero()) continue;
    const inputA = poolInfo.mintA.address === tokens()[symbol];
    const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo, inputA, tickLower, tickUpper, amount: budget(symbol), slippage: 0, add: true, epochInfo, amountHasFee: true,
    });
    const other = symbol === "FOOD" ? "GEM" : "FOOD";
    const needed = inputA ? res.amountB.amount : res.amountA.amount;
    if (!res.liquidity.isZero() && needed.lte(budget(other))) {
      return openPosition(raydium, poolInfo, poolKeys, lower, upper, symbol, budget(symbol));
    }
  }
  throw new Error("Not enough tokens returned to reopen the position");
}

async function closePosition(raydium: Ray, poolInfo: ApiV3PoolInfoConcentratedItem, poolKeys: PoolKeys, position: ClmmPositionLayout) {
  const { minA, minB } = await positionAmounts(raydium, poolInfo, position, slippage);
  // decrease_liquidity(all) + collect fees + close_position (burns the NFT, refunds rent) in one transaction.
  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    poolKeys,
    ownerPosition: position,
    ownerInfo: { useSOLBalance: true, closePosition: true },
    liquidity: position.liquidity,
    amountMinA: minA,
    amountMinB: minB,
    txVersion,
  });
  return (await execute({ sendAndConfirm: true })).txId;
}

main().catch(async (err) => {
  if (err?.txId && err?.InstructionError) {
    // The SDK throws { InstructionError, txId } for a landed-but-failed tx; the reason is in its logs.
    const tx = await conn.getTransaction(err.txId, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    const reason = tx?.meta?.logMessages?.find((line) => line.includes("Error Code:"));
    console.error(`transaction failed: ${reason?.replace(/^Program log: /, "") ?? JSON.stringify(err.InstructionError)}`);
    console.error(`tx ${explorerTx(err.txId)}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
    if (err?.logs) console.error(err.logs.join("\n"));
  }
  process.exit(1);
});
