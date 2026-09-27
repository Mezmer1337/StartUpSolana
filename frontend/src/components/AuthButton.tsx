import type { FC } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "./Button";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Navbar control: Sign in with Phantom → (Phantom signs a message) → signed-in badge + Sign out. */
export const AuthButton: FC<{ large?: boolean }> = ({ large }) => {
  const { status, wallet, signIn, signOut } = useAuth();
  const { publicKey, disconnect } = useWallet();
  const size = large ? "!px-6 !py-3 !text-base" : "";

  if (status === "signed-in" && wallet) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-green-300 glass rounded-full px-3 py-1.5 font-mono" title={wallet}>
          ✓ {short(wallet)}
        </span>
        <Button variant="secondary" onClick={signOut} className="!py-1.5 !px-3 !text-xs">
          Sign out
        </Button>
      </div>
    );
  }

  if (status === "connected" || status === "signing-in") {
    return (
      <div className="flex items-center gap-2">
        <Button onClick={signIn} disabled={status === "signing-in"} className={size}>
          {status === "signing-in" ? "Confirm in Phantom…" : `Sign in as ${publicKey ? short(publicKey.toBase58()) : ""}`}
        </Button>
        {!large && (
          <button onClick={() => disconnect()} className="text-xs text-gray-400 hover:text-white" title="Disconnect wallet">
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <Button onClick={signIn} disabled={status === "connecting"} className={size}>
      {status === "connecting" ? "Connecting…" : "Sign in with Phantom"}
    </Button>
  );
};

/** Shown instead of a page that needs a signed-in wallet. */
export const SignInPrompt: FC<{ action: string }> = ({ action }) => (
  <div className="glass rounded-2xl p-12 my-10 text-center flex flex-col items-center gap-4 max-w-lg mx-auto">
    <div className="text-5xl">👛</div>
    <p className="text-gray-300">Sign in with your Phantom wallet to {action}.</p>
    <p className="text-xs text-gray-500">
      Phantom will ask you to sign a message. It proves you own the wallet — no transaction, no fee.
    </p>
    <AuthButton large />
  </div>
);
