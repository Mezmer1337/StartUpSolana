import { NextFunction, Request, Response } from "express";
import { ApiError, asyncHandler } from "./errorHandler";
import { getActiveSession } from "../services/authService";

export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  return match ? match[1] : null;
}

/** Requires a valid session (Sign In With Solana); puts its wallet in res.locals.authWallet. */
export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) throw new ApiError(401, "Sign in with your wallet first");
  const session = await getActiveSession(token);
  if (!session) throw new ApiError(401, "Your session has expired — sign in again");
  res.locals.authWallet = session.wallet;
  next();
});

/**
 * For routes that act on behalf of the wallet in `req.body[field]`: the
 * caller must be signed in AS that wallet. This is what turns the old
 * "trust whatever ownerWallet the client sends" into a real check.
 */
export function requireSignedInWallet(field: string) {
  return [
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      if (req.body?.[field] !== res.locals.authWallet) {
        throw new ApiError(403, `"${field}" must be the wallet you signed in with`);
      }
      next();
    },
  ];
}
