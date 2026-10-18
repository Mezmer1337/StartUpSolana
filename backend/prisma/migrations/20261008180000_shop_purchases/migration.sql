-- CreateTable
CREATE TABLE "ShopPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletAddress" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paymentSignature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopPurchase_paymentSignature_key" ON "ShopPurchase"("paymentSignature");

-- CreateIndex
CREATE INDEX "ShopPurchase_walletAddress_createdAt_idx" ON "ShopPurchase"("walletAddress", "createdAt");

