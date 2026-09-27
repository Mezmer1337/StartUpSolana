import type { FC } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { AuthButton } from "./AuthButton";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/pets", label: "My Pets" },
  { to: "/inventory", label: "Inventory" },
  { to: "/games", label: "Mini Games" },
  { to: "/quests", label: "Quests" },
  { to: "/marketplace", label: "Marketplace" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/profile", label: "Profile" },
];

export const Navbar: FC = () => {
  const { signedIn } = useAuth();
  const balance = useWalletBalance();

  return (
    <header className="sticky top-0 z-40 glass border-b border-white/5">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <NavLink to="/" className="flex items-center gap-2 shrink-0">
          <span className="text-2xl">🐾</span>
          <span className="text-lg font-bold gradient-text">PetNFT</span>
        </NavLink>

        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-purple-500/20 text-purple-200" : "text-gray-400 hover:text-white hover:bg-white/5"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {signedIn && (
            <span className="hidden sm:inline text-xs text-gray-400 glass rounded-full px-3 py-1.5">
              {balance !== null ? `${balance.toFixed(2)} SOL` : "…"}
            </span>
          )}
          <AuthButton />
        </div>
      </div>

      <nav className="md:hidden flex items-center gap-1 overflow-x-auto px-4 pb-2">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                isActive ? "bg-purple-500/20 text-purple-200" : "text-gray-400"
              }`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
};
