-- AlterTable
ALTER TABLE "MarketplaceListing" ADD COLUMN "paymentSignature" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "reservedBy" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "reservedUntil" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_paymentSignature_key" ON "MarketplaceListing"("paymentSignature");

