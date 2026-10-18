import express from "express";
import cors from "cors";
import { existsSync } from "fs";
import { resolve } from "path";
import apiRouter from "./routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();
  // Behind Railway's (or any) HTTPS proxy: trust X-Forwarded-Proto so URLs we
  // build — e.g. the NFT image URI baked on-chain — are https://, not http://.
  app.set("trust proxy", true);

  app.use(cors());
  app.use(express.json());

  app.use("/api", apiRouter);

  // Production single-service deploy: also serve the built frontend, with an
  // SPA fallback so deep links like /pets/123 load index.html.
  const frontendDist = process.env.FRONTEND_DIST && resolve(process.env.FRONTEND_DIST);
  if (frontendDist && existsSync(resolve(frontendDist, "index.html"))) {
    app.use(express.static(frontendDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(frontendDist, "index.html")));
  }

  app.use(errorHandler);

  return app;
}
