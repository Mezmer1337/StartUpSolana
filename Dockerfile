# PetNFT — single-service image for Railway (or any Docker host).
# The Express backend serves both /api and the built React frontend, so the
# whole app lives on one domain (no CORS, one URL for NFT metadata).
# SQLite lives on a mounted volume at /data (DATABASE_URL below).

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Same npm major as the lockfiles were written with (npm 10 rejects them: peer resolution differs).
RUN npm install -g npm@11.6.2 --no-audit --no-fund
WORKDIR /app

# Dependencies first (cached between deploys unless package files change).
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --no-audit --no-fund
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --no-audit --no-fund

COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

# Frontend build-time config (Vite inlines VITE_* at build). The API is on
# the same origin, so a relative base. Override with Railway variables.
ARG VITE_API_BASE_URL=/api
ARG VITE_SOLANA_NETWORK=devnet
ARG VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG VITE_PLAYER_PROFILE_PROGRAM_ID=CP6Fmq98dsLrpev7EjEVvuGQ1z2aG9H7vAuDiRPDnYkB
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SOLANA_NETWORK=$VITE_SOLANA_NETWORK \
    VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL \
    VITE_PLAYER_PROFILE_PROGRAM_ID=$VITE_PLAYER_PROFILE_PROGRAM_ID
RUN cd frontend && npm run build

RUN cd backend && npx prisma generate && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production \
    FRONTEND_DIST=/app/frontend/dist \
    DATABASE_URL=file:/data/petnft.db

WORKDIR /app/backend
# Apply migrations + seed the item catalog (idempotent upserts), then serve.
CMD ["sh", "-c", "mkdir -p /data && npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/backend/src/server.js"]
