-- CreateTable
CREATE TABLE "AMFIClassification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "companyName" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "avgMarketCap" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AMFIClassification_symbol_idx" ON "AMFIClassification"("symbol");

-- CreateIndex
CREATE INDEX "AMFIClassification_period_idx" ON "AMFIClassification"("period");

-- CreateIndex
CREATE INDEX "AMFIClassification_category_idx" ON "AMFIClassification"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AMFIClassification_period_symbol_key" ON "AMFIClassification"("period", "symbol");
