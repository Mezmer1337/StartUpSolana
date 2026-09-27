import { generateKeyPairSync, sign } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSignInMessage,
  hashToken,
  resolveOrigin,
  verifyWalletSignature,
} from "../src/services/authService";

/** A throwaway ed25519 keypair; its public key IS a Solana wallet address. */
function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return {
    address: new PublicKey(raw).toBase58(),
    signMessage: (message: string) => sign(null, Buffer.from(message, "utf8"), privateKey),
  };
}

const FIELDS = {
  domain: "localhost:5173",
  address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  statement: "Sign in to PetNFT.",
  uri: "http://localhost:5173",
  chainId: "devnet",
  nonce: "a1b2c3d4e5f6a7b8",
  issuedAt: "2026-09-27T10:00:00.000Z",
  expirationTime: "2026-09-27T10:05:00.000Z",
};

describe("authService — Sign In With Solana", () => {
  it("builds the SIWS message wallets show to the user", () => {
    expect(buildSignInMessage(FIELDS).split("\n")).toEqual([
      "localhost:5173 wants you to sign in with your Solana account:",
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "",
      "Sign in to PetNFT.",
      "",
      "URI: http://localhost:5173",
      "Version: 1",
      "Chain ID: devnet",
      "Nonce: a1b2c3d4e5f6a7b8",
      "Issued At: 2026-09-27T10:00:00.000Z",
      "Expiration Time: 2026-09-27T10:05:00.000Z",
    ]);
  });

  it("accepts a signature made by the wallet's key", () => {
    const wallet = testWallet();
    const message = buildSignInMessage({ ...FIELDS, address: wallet.address });
    expect(verifyWalletSignature(wallet.address, Buffer.from(message), wallet.signMessage(message))).toBe(true);
  });

  it("rejects a signature from another wallet, a changed message or garbage", () => {
    const wallet = testWallet();
    const other = testWallet();
    const message = buildSignInMessage({ ...FIELDS, address: wallet.address });
    const signature = wallet.signMessage(message);

    expect(verifyWalletSignature(other.address, Buffer.from(message), signature)).toBe(false);
    expect(verifyWalletSignature(wallet.address, Buffer.from(message.replace("Nonce", "nonce")), signature)).toBe(false);
    expect(verifyWalletSignature(wallet.address, Buffer.from(message), signature.subarray(0, 63))).toBe(false);
    expect(verifyWalletSignature("not-a-wallet", Buffer.from(message), signature)).toBe(false);
  });

  describe("resolveOrigin", () => {
    const saved = process.env.AUTH_ALLOWED_ORIGINS;
    afterEach(() => {
      process.env.AUTH_ALLOWED_ORIGINS = saved;
    });

    it("binds the message to an allowed frontend origin", () => {
      process.env.AUTH_ALLOWED_ORIGINS = "http://localhost:5173, https://petnft.example/";
      expect(resolveOrigin("https://petnft.example")).toBe("https://petnft.example");
      expect(resolveOrigin(undefined)).toBe("http://localhost:5173");
      expect(() => resolveOrigin("https://evil.example")).toThrow(/not allowed/);
    });
  });

  it("stores tokens only as sha256", () => {
    expect(hashToken("token")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("token")).not.toBe(hashToken("token2"));
  });
});
