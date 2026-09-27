import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { FC, ReactNode } from "react";
import type { Pet } from "../types/pet";
import type { InventoryEntry } from "../types/item";
import type { UserAccount } from "../types/user";
import { inventoryApi, petApi, userApi } from "../services/api";
import { useAuth } from "./AuthContext";

interface GameDataState {
  wallet: string | null;
  user: UserAccount | null;
  pets: Pet[];
  inventory: InventoryEntry[];
  loading: boolean;
  refreshAll: () => Promise<void>;
  refreshPets: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  upsertPet: (pet: Pet) => void;
}

const GameDataContext = createContext<GameDataState | null>(null);

export const GameDataProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Game data belongs to the signed-in wallet, not merely a connected one.
  const { wallet } = useAuth();

  const [user, setUser] = useState<UserAccount | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshPets = useCallback(async () => {
    if (!wallet) return;
    setPets(await petApi.getByWallet(wallet));
  }, [wallet]);

  const refreshInventory = useCallback(async () => {
    if (!wallet) return;
    setInventory(await inventoryApi.get(wallet));
  }, [wallet]);

  const refreshAll = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const profile = await userApi.getProfile(wallet);
      setUser(profile.user);
      setPets(profile.pets);
      setInventory(profile.inventory);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (wallet) {
      refreshAll();
    } else {
      setUser(null);
      setPets([]);
      setInventory([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  const upsertPet = useCallback((pet: Pet) => {
    setPets((prev) => {
      const exists = prev.some((p) => p.id === pet.id);
      return exists ? prev.map((p) => (p.id === pet.id ? pet : p)) : [pet, ...prev];
    });
  }, []);

  return (
    <GameDataContext.Provider
      value={{ wallet, user, pets, inventory, loading, refreshAll, refreshPets, refreshInventory, upsertPet }}
    >
      {children}
    </GameDataContext.Provider>
  );
};

export function useGameData() {
  const ctx = useContext(GameDataContext);
  if (!ctx) throw new Error("useGameData must be used within GameDataProvider");
  return ctx;
}
