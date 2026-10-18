import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../middleware/errorHandler";
import { ITEM_CATALOG, ITEM_PRICES } from "../constants/items";
import { getOrCreateUser } from "./userService";
import { grantItem } from "./inventoryService";
import { getTreasuryWallet, verifySolTransfers } from "./solanaVerifyService";

const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_QUANTITY = 10;
/** A SOL payment must be this fresh to buy something (stops old transfers being reused as new orders). */
const PAYMENT_MAX_AGE_MS = 15 * 60 * 1000;

export type ShopCurrency = "PETCOIN" | "SOL";

/** The shop as the frontend shows it: every item with its prices, plus where SOL goes. */
export function getShop() {
  return {
    treasuryWallet: getTreasuryWallet(),
    items: ITEM_CATALOG.filter((i) => ITEM_PRICES[i.key]).map((i) => ({ ...i, price: ITEM_PRICES[i.key] })),
  };
}

/** Exact lamports for a SOL order — the frontend pays this, the backend verifies this. */
export function solOrderLamports(itemKey: string, quantity: number): number {
  const price = ITEM_PRICES[itemKey]?.sol;
  if (price == null) throw new ApiError(400, "This item can't be bought with SOL");
  return Math.round(price * quantity * LAMPORTS_PER_SOL);
}

/**
 * Buys `quantity` of an item. PetCoins are deducted atomically (no going
 * negative under concurrent requests). SOL purchases must come with the
 * signature of an on-chain transfer to the treasury, which is read back from
 * devnet and can only ever pay for one order.
 */
export async function buyItem(wallet: string, itemKey: string, quantity: number, currency: ShopCurrency, txSignature?: string) {
  const def = ITEM_CATALOG.find((i) => i.key === itemKey);
  const price = ITEM_PRICES[itemKey];
  if (!def || !price) throw new ApiError(404, `Unknown item "${itemKey}"`);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new ApiError(400, `Quantity must be 1–${MAX_QUANTITY}`);
  }
  await getOrCreateUser(wallet);

  if (currency === "PETCOIN") {
    if (price.petCoins == null) throw new ApiError(400, `${def.name} can only be bought with SOL`);
    const cost = price.petCoins * quantity;
    const { count } = await prisma.user.updateMany({
      where: { walletAddress: wallet, petCoins: { gte: cost } },
      data: { petCoins: { decrement: cost } },
    });
    if (count === 0) throw new ApiError(400, `Not enough PetCoins (needs ${cost})`);
    await prisma.shopPurchase.create({ data: { walletAddress: wallet, itemKey, quantity, currency, amount: cost } });
  } else if (currency === "SOL") {
    if (!txSignature) throw new ApiError(400, "txSignature is required — pay in your wallet first");
    const lamports = solOrderLamports(itemKey, quantity);
    if (await prisma.shopPurchase.findUnique({ where: { paymentSignature: txSignature } })) {
      throw new ApiError(409, "This payment was already used for another order");
    }
    await verifySolTransfers(txSignature, wallet, [{ wallet: getTreasuryWallet(), lamports }], new Date(Date.now() - PAYMENT_MAX_AGE_MS));
    try {
      await prisma.shopPurchase.create({
        data: { walletAddress: wallet, itemKey, quantity, currency, amount: lamports / LAMPORTS_PER_SOL, paymentSignature: txSignature },
      });
    } catch (err) {
      // Two simultaneous requests with the same signature: only the first wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ApiError(409, "This payment was already used for another order");
      }
      throw err;
    }
  } else {
    throw new ApiError(400, 'currency must be "PETCOIN" or "SOL"');
  }

  const entry = await grantItem(wallet, itemKey, quantity);
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  return { entry, petCoins: user?.petCoins ?? 0 };
}
