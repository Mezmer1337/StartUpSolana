import type { FC, ReactNode } from "react";
import { Navbar } from "./Navbar";

export const Layout: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex flex-col">
    <Navbar />
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-5 sm:py-8">{children}</main>
    {/* Bottom padding on < lg keeps the footer clear of the fixed tab bar. */}
    <footer className="text-center text-xs text-gray-500 pt-6 pb-24 lg:pb-6 px-4 border-t border-white/5">
      PetNFT MVP — running on Solana Devnet. Not real funds. Built for learning &amp; demo purposes.
    </footer>
  </div>
);
