// Raydium on devnet (course tasks 11-13): test tokens, a CPMM ("AMM") pool and a CLMM pool, swaps and
// concentrated-liquidity positions. Used by clients/raydium.ts.
//
// Everything goes through @raydium-io/raydium-sdk-v2 against Raydium's DEVNET programs; addresses of the
// tokens and pools we create are kept in clients/.raydium-devnet.json.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  ClmmConfigLayout,
  CpmmConfigInfoLayout,
  DEVNET_PROGRAM_ID,
  PoolUtils,
  PositionUtils,
  Raydium,
  TickArrayLayout,
  TickArrayUtil,
  TickUtil,
  getCpmmPdaAmmConfigId,
  getPdaAmmConfigId,
  getPdaTickArrayAddress,
  type ApiCpmmConfigInfo,
  type ApiV3PoolInfoConcentratedItem,
  type ApiV3Token,
  type ClmmConfigInfo,
  type ClmmPositionLayout,
} from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID, TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

export const CLMM_PROGRAM = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
export const CPMM_PROGRAM = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
export const CPMM_FEE_ACCOUNT = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;

/** Two in-game test tokens for the pools: pet food and gems. Plain SPL Token, 6 decimals. */
export const TEST_TOKENS = { FOOD: { name: "PetFood", decimals: 6 }, GEM: { name: "PetGem", decimals: 6 } } as const;
export type TestSymbol = keyof typeof TEST_TOKENS;

// ---------- saved addresses ----------

export interface RaydiumState {
  tokens?: Record<TestSymbol, string>;
  cpmmPool?: string;
  clmmPool?: string;
}

const STATE_FILE = join(__dirname, ".raydium-devnet.json");
export const loadState = (): RaydiumState => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
export const saveState = (state: RaydiumState) => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

// ---------- SDK, tokens, amounts ----------

// SDK 0.2.80 workaround: a freshly created pool has no initialized tick arrays, the tick cache comes back
// without an entry for it, and clmm.getPoolInfoFromRpc crashes on Object.values(undefined). An empty
// cache per pool is what it means.
const fetchTickArrays = PoolUtils.fetchMultiplePoolTickArrays.bind(PoolUtils);
PoolUtils.fetchMultiplePoolTickArrays = async (params) => {
  const cache = await fetchTickArrays(params);
  for (const pool of params.poolKeys) cache[pool.id.toBase58()] ??= {};
  return cache;
};

export function loadRaydium(connection: Connection, owner: Keypair) {
  if (!connection.rpcEndpoint.includes("devnet")) {
    throw new Error(`Raydium's devnet programs only exist on devnet; SOLANA_RPC_URL is ${connection.rpcEndpoint}`);
  }
  return Raydium.load({
    connection,
    owner,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
  });
}

/** The SDK wants token descriptions in its API format; for our own devnet mints we build them by hand. */
export function apiToken(mint: string, symbol: TestSymbol): ApiV3Token {
  return {
    chainId: 103,
    address: mint,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    logoURI: "",
    symbol,
    name: TEST_TOKENS[symbol].name,
    decimals: TEST_TOKENS[symbol].decimals,
    tags: [],
    extensions: {},
  };
}

/** "12.5" -> BN in base units, without floats (same rule as parseAmount in petcoin-core). */
export function toUnits(value: string, decimals: number): BN {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2] ?? "").length > decimals) throw new Error(`Invalid amount "${value}" for ${decimals} decimals`);
  return new BN(match[1] + (match[2] ?? "").padEnd(decimals, "0"));
}

export const fromUnits = (raw: BN | bigint | string, decimals: number) => new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));

export async function tokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey) {
  try {
    return new BN((await getAccount(connection, getAssociatedTokenAddressSync(mint, owner), "confirmed")).amount.toString());
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return new BN(0);
    throw err;
  }
}

// ---------- fee configs (read from chain: devnet has its own config accounts) ----------

export async function clmmConfigs(connection: Connection): Promise<ClmmConfigInfo[]> {
  const ids = Array.from({ length: 8 }, (_, index) => getPdaAmmConfigId(CLMM_PROGRAM, index).publicKey);
  const accounts = await connection.getMultipleAccountsInfo(ids);
  return accounts.flatMap((account, i) => {
    if (!account) return [];
    const c = ClmmConfigLayout.decode(account.data);
    return [{ id: ids[i], index: c.index, protocolFeeRate: c.protocolFeeRate, tradeFeeRate: c.tradeFeeRate, tickSpacing: c.tickSpacing, fundFeeRate: c.fundFeeRate, fundOwner: c.fundOwner.toBase58(), description: "" }];
  });
}

export async function cpmmConfigs(connection: Connection): Promise<(ApiCpmmConfigInfo & { disabled: boolean })[]> {
  const ids = Array.from({ length: 8 }, (_, index) => getCpmmPdaAmmConfigId(CPMM_PROGRAM, index).publicKey);
  const accounts = await connection.getMultipleAccountsInfo(ids);
  return accounts.flatMap((account, i) => {
    if (!account) return [];
    const c = CpmmConfigInfoLayout.decode(account.data);
    return [{
      id: ids[i].toBase58(),
      index: c.index,
      protocolFeeRate: c.protocolFeeRate.toNumber(),
      tradeFeeRate: c.tradeFeeRate.toNumber(),
      fundFeeRate: c.fundFeeRate.toNumber(),
      createPoolFee: c.createPoolFee.toString(),
      creatorFeeRate: c.creatorFeeRate.toNumber(),
      disabled: c.disableCreatePool,
    }];
  });
}

// ---------- CLMM math helpers ----------

/**
 * Pool prices are always "mintB per 1 mintA", and the SDK orders the mints by address, so FOOD can end up
 * as A or B. We talk to the user in GEM per FOOD and flip when needed.
 */
export function foodPrice(pool: Pick<ApiV3PoolInfoConcentratedItem, "mintA">, poolPrice: Decimal.Value, foodMint: string) {
  const price = new Decimal(poolPrice);
  return pool.mintA.address === foodMint ? price : new Decimal(1).div(price);
}

export function toPoolPrice(pool: Pick<ApiV3PoolInfoConcentratedItem, "mintA">, gemPerFood: Decimal.Value, foodMint: string) {
  return foodPrice(pool, gemPerFood, foodMint); // the flip is its own inverse
}

/**
 * Price range (in pool orientation) -> ticks on the pool's tick spacing. Liquidity can only start and end
 * on multiples of tickSpacing; the range is widened outwards to the nearest ones.
 */
export function rangeToTicks(pool: ApiV3PoolInfoConcentratedItem, priceA: Decimal, priceB: Decimal) {
  const spacing = pool.config.tickSpacing;
  const [low, high] = priceA.lt(priceB) ? [priceA, priceB] : [priceB, priceA];
  const tickLower = Math.floor(TickUtil.priceToTick(low, pool.mintA.decimals, pool.mintB.decimals) / spacing) * spacing;
  let tickUpper = Math.ceil(TickUtil.priceToTick(high, pool.mintA.decimals, pool.mintB.decimals) / spacing) * spacing;
  if (tickUpper === tickLower) tickUpper += spacing;
  return { tickLower, tickUpper };
}

export const tickPrice = (pool: ApiV3PoolInfoConcentratedItem, tick: number) =>
  TickUtil.tickToPrice(tick, pool.mintA.decimals, pool.mintB.decimals);

/** Reads the two tick accounts a position is bounded by; fees owed are computed from them. */
async function tickStates(connection: Connection, poolId: PublicKey, spacing: number, ticks: number[]) {
  const starts = ticks.map((tick) => TickArrayUtil.getTickArrayStartIndex(tick, spacing));
  const accounts = await connection.getMultipleAccountsInfo(starts.map((s) => getPdaTickArrayAddress(CLMM_PROGRAM, poolId, s).publicKey));
  return ticks.map((tick, i) => {
    if (!accounts[i]) throw new Error(`Tick array for tick ${tick} not found`);
    return TickArrayLayout.decode(accounts[i]!.data).ticks[TickArrayUtil.getTickOffsetInArray(tick, spacing)];
  });
}

/** Fees earned by a position that are not collected yet: what was settled on-chain + what accrued since. */
export async function pendingFees(raydium: Raydium, position: ClmmPositionLayout) {
  const pool = await raydium.clmm.getRpcClmmPoolInfo({ poolId: position.poolId });
  const [lower, upper] = await tickStates(raydium.connection, position.poolId, pool.tickSpacing, [position.tickLower, position.tickUpper]);
  return PositionUtils.GetPositionFees(pool, position, lower, upper);
}

/** Token amounts that a position's liquidity is worth right now, minus `slippage` (0.01 = 1%). */
export async function positionAmounts(raydium: Raydium, pool: ApiV3PoolInfoConcentratedItem, position: ClmmPositionLayout, slippage: number) {
  const { amountSlippageA, amountSlippageB, amountA, amountB } = await PoolUtils.getAmountsFromLiquidity({
    poolInfo: pool,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity,
    slippage,
    add: false,
    epochInfo: await raydium.fetchEpochInfo(),
  });
  return { amountA: amountA.amount, amountB: amountB.amount, minA: amountSlippageA.amount, minB: amountSlippageB.amount };
}
