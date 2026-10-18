import { Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shop } from "./pages/Shop";
import { ArtLab } from "./pages/ArtLab";
import { GamesCatalog } from "./pages/GamesCatalog";
import { ArcadeGame } from "./pages/ArcadeGame";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { MyPets } from "./pages/MyPets";
import { PetProfile } from "./pages/PetProfile";
import { Inventory } from "./pages/Inventory";
import { Quests } from "./pages/Quests";
import { Marketplace } from "./pages/Marketplace";
import { Leaderboard } from "./pages/Leaderboard";
import { Profile } from "./pages/Profile";

function App() {
  const { pathname } = useLocation();
  return (
    <Layout>
      {/* A crash in one page never blanks the whole app; navigating away resets it. */}
      <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/pets" element={<MyPets />} />
        <Route path="/pets/:id" element={<PetProfile />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/games" element={<GamesCatalog />} />
        <Route path="/games/:slug" element={<ArcadeGame />} />
        <Route path="/quests" element={<Quests />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/profile" element={<Profile />} />
        {/* Dev-only art & training sandbox (not in production builds). */}
        {import.meta.env.DEV && <Route path="/lab" element={<ArtLab />} />}
      </Routes>
      </ErrorBoundary>
    </Layout>
  );
}

export default App;
