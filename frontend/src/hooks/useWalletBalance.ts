import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/** Polls the connected wallet's SOL balance on devnet. */
export function useWalletBalance(intervalMs = 15000) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    let cancelled = false;

    const fetchBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        if (!cancelled) setBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setBalance(null);
      }
    };

    fetchBalance();
    const id = setInterval(fetchBalance, intervalMs);
    // Re-read right away after a payment (services/marketplacePayment.ts).
    window.addEventListener("wallet-balance-refresh", fetchBalance);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("wallet-balance-refresh", fetchBalance);
    };
  }, [connection, publicKey, intervalMs]);

  return balance;
}
