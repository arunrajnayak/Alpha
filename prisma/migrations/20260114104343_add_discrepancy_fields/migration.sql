/*
  Warnings:

  - You are about to drop the `CorporateAction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `hidden` on the `Transaction` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "CorporateAction_date_symbol_type_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CorporateAction";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyPortfolioSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "totalEquity" REAL NOT NULL,
    "investedCapital" REAL NOT NULL,
    "portfolioNAV" REAL NOT NULL,
    "niftyNAV" REAL,
    "units" REAL NOT NULL,
    "cashflow" REAL,
    "dailyPnL" REAL,
    "dailyReturn" REAL,
    "drawdown" REAL,
    "navMA200" REAL,
    "nifty500Momentum50NAV" REAL,
    "niftyMicrocap250NAV" REAL,
    "niftyMidcap100NAV" REAL,
    "niftySmallcap250NAV" REAL,
    "hasDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "discrepancyData" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_DailyPortfolioSnapshot" ("cashflow", "dailyPnL", "dailyReturn", "date", "drawdown", "id", "investedCapital", "navMA200", "nifty500Momentum50NAV", "niftyMicrocap250NAV", "niftyMidcap100NAV", "niftyNAV", "niftySmallcap250NAV", "portfolioNAV", "totalEquity", "units") SELECT "cashflow", "dailyPnL", "dailyReturn", "date", "drawdown", "id", "investedCapital", "navMA200", "nifty500Momentum50NAV", "niftyMicrocap250NAV", "niftyMidcap100NAV", "niftyNAV", "niftySmallcap250NAV", "portfolioNAV", "totalEquity", "units" FROM "DailyPortfolioSnapshot";
DROP TABLE "DailyPortfolioSnapshot";
ALTER TABLE "new_DailyPortfolioSnapshot" RENAME TO "DailyPortfolioSnapshot";
CREATE UNIQUE INDEX "DailyPortfolioSnapshot_date_key" ON "DailyPortfolioSnapshot"("date");
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "splitRatio" REAL,
    "newSymbol" TEXT,
    "description" TEXT,
    "importBatchId" INTEGER,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("createdAt", "date", "description", "id", "importBatchId", "newSymbol", "orderId", "price", "quantity", "splitRatio", "symbol", "type") SELECT "createdAt", "date", "description", "id", "importBatchId", "newSymbol", "orderId", "price", "quantity", "splitRatio", "symbol", "type" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_orderId_key" ON "Transaction"("orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
