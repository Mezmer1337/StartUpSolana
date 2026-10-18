import { useState } from "react";
import type { FC } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { AuthButton } from "./AuthButton";

const links = [
  { to: "/", label: "Home", icon: "🏠", end: true },
  { to: "/pets", label: "My Pets", icon: "🐾" },
  { to: "/inventory", label: "Inventory", icon: "🎒" },
  { to: "/games", label: "Games", icon: "🎮" },
  { to: "/quests", label: "Quests", icon: "📜" },
  { to: "/marketplace", label: "Marketplace", icon: "🛒" },
  { to: "/shop", label: "Shop", icon: "🏪" },
  { to: "/leaderboard", label: "Leaderboard", icon: "🏆" },
  { to: "/profile", label: "Profile", icon: "👤" },
];

/** Phone/tablet bottom bar: the 4 most-used sections + "More" for the rest. */
const TAB_BAR = ["/pets", "/games", "/marketplace", "/quests"];

export const Navbar: FC = () => {
  const { signedIn } = useAuth();
  const balance = useWalletBalance();
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const inMore = !TAB_BAR.some((p) => pathname.startsWith(p));

  return (
    <>
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-2.5 lg:py-3 flex items-center justify-between gap-3">
          <NavLink to="/" className="flex items-center gap-2 shrink-0">
            <span className="text-2xl">🐾</span>
            <span className="text-lg font-bold gradient-text">PetNFT</span>
          </NavLink>

          <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `px-2.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? "bg-purple-500/20 text-purple-200" : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 min-w-0">
            {signedIn && (
              <span className="hidden sm:inline text-xs text-gray-400 glass rounded-full px-3 py-1.5 whitespace-nowrap">
                {balance !== null ? `${balance.toFixed(2)} SOL` : "…"}
              </span>
            )}
            <AuthButton />
          </div>
        </div>
      </header>

      {/* Bottom tab bar (< lg). Respects the iPhone home-indicator inset. */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-white/10 grid grid-cols-5"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", background: "rgba(14,13,28,0.92)" }}
      >
        {links
          .filter((l) => TAB_BAR.includes(l.to))
          .map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-purple-200" : "text-gray-400"}`
              }
            >
              <span className="text-xl leading-none">{l.icon}</span>
              {l.label === "Marketplace" ? "Market" : l.label === "My Pets" ? "Pets" : l.label}
            </NavLink>
          ))}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${moreOpen || inMore ? "text-purple-200" : "text-gray-400"}`}
        >
          <span className="text-xl leading-none">☰</span>
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-30" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-3 glass rounded-2xl p-2 grid grid-cols-2 gap-1"
            style={{ bottom: "calc(64px + env(safe-area-inset-bottom))", background: "rgba(20,18,38,0.97)" }}
          >
            {links
              .filter((l) => !TAB_BAR.includes(l.to))
              .map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-3 rounded-xl text-sm ${isActive ? "bg-purple-500/20 text-purple-200" : "text-gray-300"}`
                  }
                >
                  <span className="text-lg">{l.icon}</span>
                  {l.label}
                </NavLink>
              ))}
          </div>
        </div>
      )}
    </>
  );
};
