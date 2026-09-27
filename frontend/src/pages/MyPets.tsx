import { useState } from "react";
import type { FC } from "react";
import { PetCard } from "../components/PetCard";
import { SignInPrompt } from "../components/AuthButton";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/Button";
import { CreatePetModal } from "../components/CreatePetModal";
import { useGameData } from "../context/GameDataContext";

export const MyPets: FC = () => {
  const { signedIn } = useAuth();
  const { pets, loading } = useGameData();
  const [createOpen, setCreateOpen] = useState(false);

  if (!signedIn) return <SignInPrompt action="view your pets" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">My Pets</h1>
        <Button onClick={() => setCreateOpen(true)}>+ Create Pet</Button>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading pets…</p>}

      {!loading && pets.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center flex flex-col items-center gap-4">
          <div className="text-5xl">🥚</div>
          <p className="text-gray-400">You don't have any pets yet.</p>
          <Button onClick={() => setCreateOpen(true)}>Create your first pet</Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {pets.map((pet) => (
          <PetCard key={pet.id} pet={pet} />
        ))}
      </div>

      <CreatePetModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
};
