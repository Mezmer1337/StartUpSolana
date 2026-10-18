import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { SolanaProviders } from "./providers/SolanaProviders";
import { AuthProvider } from "./context/AuthContext";
import { GameDataProvider } from "./context/GameDataContext";
import { ToastProvider } from "./context/ToastContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { reportClientError } from "./services/errorReporting";

// Errors outside React rendering (event handlers, promises) go to the server log too.
window.addEventListener("error", (e) => reportClientError(e.error ?? e.message, "window.onerror"));
window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason, "unhandledrejection"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Last line of defence: even a crash in the providers shows a Reload screen, not a blank page. */}
    <ErrorBoundary>
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
    </ErrorBoundary>
  </StrictMode>
);
