import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FC, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { WalletName } from "@solana/wallet-adapter-base";
import { authApi, extractErrorMessage, setAuthToken, setUnauthorizedHandler } from "../services/api";
import type { AuthSession } from "../services/api";
import { useToast } from "./ToastContext";

/**
 * Sign In With Solana. Connecting a wallet only tells the app an address;
 * signing in proves the user controls it: the backend sends a one-time
 * message, Phantom signs it (no transaction, no fee), the backend checks
 * the signature and returns a session token that every state-changing API
 * call carries (see backend/src/services/authService.ts).
 */

const STORAGE_KEY = "petnft.session";
const PHANTOM = "Phantom" as WalletName<"Phantom">;

type AuthStatus = "disconnected" | "connecting" | "connected" | "signing-in" | "signed-in";

interface AuthState {
  status: AuthStatus;
  /** The signed-in wallet, or null. Only this wallet may act through the API. */
  wallet: string | null;
  signedIn: boolean;
  /** Connects Phantom if needed, then asks it to sign the sign-in message. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

function loadSession(): AuthSession | null {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as AuthSession | null;
    return session && new Date(session.expiresAt).getTime() > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function storeSession(session: AuthSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode) — the session just won't survive a reload.
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { publicKey, connected, connecting, signMessage, disconnect, wallets, select } = useWallet();
  const { setVisible } = useWalletModal();
  const { showToast } = useToast();
  const address = publicKey?.toBase58() ?? null;

  const [session, setSession] = useState<AuthSession | null>(() => {
    const stored = loadSession();
    setAuthToken(stored?.token ?? null);
    return stored;
  });
  const [signingIn, setSigningIn] = useState(false);
  const signInAfterConnect = useRef(false);
  const wasConnected = useRef(false);

  const applySession = useCallback((next: AuthSession | null) => {
    setAuthToken(next?.token ?? null);
    storeSession(next);
    setSession(next);
  }, []);

  // The backend rejected our token (expired / revoked): drop it.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      applySession(null);
      showToast("Your session has expired — sign in again", "info");
    });
    return () => setUnauthorizedHandler(null);
  }, [applySession, showToast]);

  // A stored session is only trusted after the backend confirms it once.
  useEffect(() => {
    if (!session) return;
    authApi.session().catch(() => applySession(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async () => {
    if (!publicKey) {
      // Not connected yet: connect first; the effect below continues the sign-in.
      signInAfterConnect.current = true;
      const phantom = wallets.find((w) => w.adapter.name === PHANTOM);
      if (phantom && phantom.readyState === WalletReadyState.Installed) {
        select(PHANTOM);
      } else if (wallets.some((w) => w.readyState === WalletReadyState.Installed)) {
        setVisible(true);
      } else {
        signInAfterConnect.current = false;
        showToast("Phantom is not installed — opening phantom.app", "info");
        window.open("https://phantom.app/download", "_blank", "noopener");
      }
      return;
    }
    if (!signMessage) {
      showToast("This wallet can't sign messages — use Phantom", "error");
      return;
    }

    const wallet = publicKey.toBase58();
    setSigningIn(true);
    try {
      const { nonce, message } = await authApi.nonce(wallet);
      const signature = await signMessage(new TextEncoder().encode(message));
      applySession(await authApi.verify(wallet, nonce, toBase64(signature)));
      showToast(`Signed in as ${short(wallet)}`, "success");
    } catch (err) {
      const text = extractErrorMessage(err);
      showToast(/reject|cancel|denied/i.test(text) ? "Sign-in cancelled in the wallet" : text, "error");
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage, wallets, select, setVisible, showToast, applySession]);

  useEffect(() => {
    // Finish a sign-in that had to connect the wallet first.
    if (connected && address && signInAfterConnect.current) {
      signInAfterConnect.current = false;
      if (session?.wallet !== address) void signIn();
    }
    // A session belongs to one wallet: switching accounts in Phantom signs you out.
    if (connected && address && session && session.wallet !== address) applySession(null);
    // Disconnecting the wallet signs you out too.
    if (wasConnected.current && !connected && session) applySession(null);
    wasConnected.current = connected;
  }, [connected, address, session, signIn, applySession]);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    applySession(null);
    await disconnect().catch(() => undefined);
  }, [applySession, disconnect]);

  const signedIn = !!session && connected && session.wallet === address;
  const status: AuthStatus = signedIn
    ? "signed-in"
    : signingIn
    ? "signing-in"
    : connected
    ? "connected"
    : connecting
    ? "connecting"
    : "disconnected";

  return (
    <AuthContext.Provider value={{ status, wallet: signedIn ? address : null, signedIn, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
