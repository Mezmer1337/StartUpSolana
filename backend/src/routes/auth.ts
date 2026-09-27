import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { bearerToken, requireAuth } from "../middleware/auth";
import { completeSignIn, createSignInChallenge, resolveOrigin, revokeSession } from "../services/authService";

const router = Router();

// POST /api/auth/nonce {wallet} -> {nonce, message, expiresAt}: the text the wallet must sign.
router.post(
  "/nonce",
  asyncHandler(async (req, res) => {
    res.json(await createSignInChallenge(req.body?.wallet, resolveOrigin(req.header("origin"))));
  })
);

// POST /api/auth/verify {wallet, nonce, signature(base64)} -> {token, wallet, expiresAt}
router.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { wallet, nonce, signature } = req.body ?? {};
    res.json(await completeSignIn(wallet, nonce, signature));
  })
);

// GET /api/auth/session (Bearer) -> {wallet}
router.get("/session", requireAuth, (_req, res) => {
  res.json({ wallet: res.locals.authWallet });
});

// POST /api/auth/logout (Bearer) -> 204
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);
    res.status(204).end();
  })
);

export default router;
