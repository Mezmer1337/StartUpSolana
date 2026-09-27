import { NextFunction, Request, Response } from "express";
import { ApiError } from "./errorHandler";

// Solana addresses are base58, 32-44 chars. This is a format check only —
// proof that the caller controls the wallet comes from Sign In With Solana
// (services/authService.ts + middleware/auth.ts).
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWalletAddress(address: unknown): address is string {
  return typeof address === "string" && BASE58_RE.test(address);
}

/** Ensures req.body.ownerWallet (or req.params.wallet) is a well-formed wallet address. */
export function requireWallet(source: "body" | "params" = "body", field = "ownerWallet") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = source === "body" ? req.body?.[field] : req.params?.[field];
    if (!isValidWalletAddress(value)) {
      throw new ApiError(400, `Missing or invalid wallet address ("${field}")`);
    }
    next();
  };
}
