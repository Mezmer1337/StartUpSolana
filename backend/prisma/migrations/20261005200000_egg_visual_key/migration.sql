-- Egg hatching: unique visual fingerprint per pet (see shared/petArt/visualKey.ts)
ALTER TABLE "Pet" ADD COLUMN "visualKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pet_visualKey_key" ON "Pet"("visualKey");
