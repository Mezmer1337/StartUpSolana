import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/Button";

const STEPS = [
  { icon: "👛", title: "Sign in with Phantom", desc: "Sign a one-time message with your Phantom wallet on Solana Devnet — no transaction, no fee, no seed phrase ever leaves your extension." },
  { icon: "🥚", title: "Create a Pet", desc: "Choose a species, color and rarity to bring your companion to life." },
  { icon: "🎮", title: "Feed, Play & Train", desc: "Care for your pet daily to raise its stats and level it up." },
  { icon: "⛓", title: "Mint as NFT", desc: "Turn your pet into a real Metaplex-standard NFT you truly own on-chain." },
];

const FEATURES = [
  { icon: "🔐", title: "True Ownership", desc: "Your pet's NFT lives in your own wallet — not a company database." },
  { icon: "⚡", title: "Fast & Cheap", desc: "Built on Solana — sub-second transactions, fractions of a cent in fees." },
  { icon: "📈", title: "Real Progression", desc: "XP, levels, stats and items create genuine RPG-style depth." },
  { icon: "🛒", title: "Player-Owned Economy", desc: "List, buy and trade pets on the built-in Marketplace." },
];

export const Landing: FC = () => {
  const { signedIn, status, signIn } = useAuth();
  const navigate = useNavigate();

  const handlePrimaryCta = () => {
    if (signedIn) navigate("/pets");
    else void signIn();
  };

  return (
    <div className="flex flex-col gap-24">
      <section className="text-center flex flex-col items-center gap-6 pt-8">
        <span className="glass text-xs text-purple-200 px-3 py-1 rounded-full">⚡ Live on Solana Devnet</span>
        <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight">
          Raise, Train &amp; Own
          <br />
          <span className="gradient-text">Your Pet, On-Chain</span>
        </h1>
        <p className="text-gray-400 max-w-xl text-base sm:text-lg">
          PetNFT is a GameFi Tamagotchi where your companion is a real Solana NFT.
          Feed it, play with it, level it up — and truly own the result.
        </p>
        <div className="flex gap-3">
          <Button onClick={handlePrimaryCta} className="!px-6 !py-3 !text-base">
            {signedIn
              ? "Go to My Pets"
              : status === "signing-in"
              ? "Confirm in Phantom…"
              : status === "connected"
              ? "Sign in"
              : "Sign in with Phantom"}
          </Button>
          <Button variant="secondary" onClick={() => navigate("/marketplace")} className="!px-6 !py-3 !text-base">
            Explore Marketplace
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="glass rounded-2xl p-5 relative">
              <span className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center rounded-full bg-purple-500 text-xs font-bold">
                {i + 1}
              </span>
              <div className="text-3xl mb-3">{s.icon}</div>
              <h3 className="font-semibold text-white mb-1">{s.title}</h3>
              <p className="text-sm text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-center mb-10">Why PetNFT</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass rounded-2xl p-5 text-center">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-white mb-1">{f.title}</h3>
              <p className="text-sm text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="glass rounded-3xl p-8 sm:p-12 text-center flex flex-col items-center gap-4">
        <h2 className="text-2xl font-bold">Built on Solana</h2>
        <p className="text-gray-400 max-w-2xl text-sm sm:text-base">
          Solana is a high-performance blockchain capable of thousands of transactions per second with
          sub-cent fees. PetNFT uses Solana Devnet — a free test network — so you can mint, trade and play
          without spending real money. NFTs follow the Metaplex Token Metadata standard used across the
          entire Solana NFT ecosystem.
        </p>
        <Button onClick={handlePrimaryCta} className="!px-6 !py-3 !text-base">
          Get Started
        </Button>
      </section>
    </div>
  );
};
