import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { SolanaProviders } from "./providers/SolanaProviders";
import { AuthProvider } from "./context/AuthContext";
import { GameDataProvider } from "./context/GameDataContext";
import { ToastProvider } from "./context/ToastContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SolanaProviders>
      <ToastProvider>
        <AuthProvider>
          <GameDataProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </GameDataProvider>
        </AuthProvider>
      </ToastProvider>
    </SolanaProviders>
  </StrictMode>
);
