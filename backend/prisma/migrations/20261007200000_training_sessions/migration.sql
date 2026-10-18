-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "petId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "score" INTEGER,
    "xpAwarded" INTEGER,
    "statGain" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "TrainingSession_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TrainingSession_petId_status_idx" ON "TrainingSession"("petId", "status");

-- CreateIndex
CREATE INDEX "TrainingSession_walletAddress_startedAt_idx" ON "TrainingSession"("walletAddress", "startedAt");

