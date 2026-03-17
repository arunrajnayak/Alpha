[dotenv@17.3.1] injecting env (0) from .env.local -- tip: ⚙️  write to custom object with { processEnv: myObject }
[dotenv@17.3.1] injecting env (0) from .env -- tip: ⚙️  specify custom .env file path with { path: '/custom/path/.env' }
-- CreateTable
CREATE TABLE "Transaction" (
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

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME
);

-- CreateTable
CREATE TABLE "DailyPortfolioSnapshot" (
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
    "niftySmallcap250NAV" REAL
);

-- CreateTable
CREATE TABLE "WeeklyPortfolioSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "totalEquity" REAL NOT NULL,
    "nav" REAL NOT NULL,
    "weeklyReturn" REAL,
    "largeCapPercent" REAL,
    "midCapPercent" REAL,
    "smallCapPercent" REAL,
    "microCapPercent" REAL,
    "marketCap" REAL,
    "xirr" REAL,
    "pnl" REAL,
    "winPercent" REAL,
    "lossPercent" REAL,
    "avgHoldingPeriod" REAL,
    "avgWinnerGain" REAL,
    "avgLoserLoss" REAL,
    "sectorAllocation" TEXT
);

-- CreateTable
CREATE TABLE "MonthlyPortfolioSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "totalEquity" REAL NOT NULL,
    "nav" REAL NOT NULL,
    "monthlyReturn" REAL,
    "largeCapPercent" REAL,
    "midCapPercent" REAL,
    "smallCapPercent" REAL,
    "microCapPercent" REAL,
    "marketCap" REAL,
    "xirr" REAL,
    "pnl" REAL,
    "winPercent" REAL,
    "lossPercent" REAL,
    "avgHoldingPeriod" REAL,
    "avgWinnerGain" REAL,
    "avgLoserLoss" REAL,
    "exitCount" INTEGER DEFAULT 0,
    "avgExitsPerMonth" REAL DEFAULT 0,
    "sectorAllocation" TEXT
);

-- CreateTable
CREATE TABLE "StockHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "symbol" TEXT NOT NULL,
    "close" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "IndexHistory" (
    "date" DATETIME NOT NULL,
    "symbol" TEXT NOT NULL,
    "close" REAL NOT NULL,

    PRIMARY KEY ("date", "symbol")
);

-- CreateTable
CREATE TABLE "SymbolMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "oldSymbol" TEXT NOT NULL,
    "newSymbol" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "result" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SectorMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'NSE',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UpstoxToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accessToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

-- CreateTable
CREATE TABLE "AMFIImportHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "stockCount" INTEGER NOT NULL,
    "largeCapCount" INTEGER NOT NULL,
    "midCapCount" INTEGER NOT NULL,
    "smallCapCount" INTEGER NOT NULL,
    "microCapCount" INTEGER NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IntradayPnL" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATETIME NOT NULL,
    "pnl" REAL NOT NULL,
    "percent" REAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orderId_key" ON "Transaction"("orderId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_date_symbol_idx" ON "Transaction"("date", "symbol");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPortfolioSnapshot_date_key" ON "DailyPortfolioSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPortfolioSnapshot_date_key" ON "WeeklyPortfolioSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPortfolioSnapshot_date_key" ON "MonthlyPortfolioSnapshot"("date");

-- CreateIndex
CREATE INDEX "StockHistory_symbol_idx" ON "StockHistory"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "StockHistory_date_symbol_key" ON "StockHistory"("date", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "SymbolMapping_oldSymbol_key" ON "SymbolMapping"("oldSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "SectorMapping_symbol_key" ON "SectorMapping"("symbol");

-- CreateIndex
CREATE INDEX "SectorMapping_sector_idx" ON "SectorMapping"("sector");

-- CreateIndex
CREATE INDEX "UpstoxToken_expiresAt_idx" ON "UpstoxToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AMFIClassification_symbol_idx" ON "AMFIClassification"("symbol");

-- CreateIndex
CREATE INDEX "AMFIClassification_period_idx" ON "AMFIClassification"("period");

-- CreateIndex
CREATE INDEX "AMFIClassification_category_idx" ON "AMFIClassification"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AMFIClassification_period_symbol_key" ON "AMFIClassification"("period", "symbol");

-- CreateIndex
CREATE INDEX "AMFIImportHistory_period_idx" ON "AMFIImportHistory"("period");

-- CreateIndex
CREATE INDEX "IntradayPnL_date_idx" ON "IntradayPnL"("date");

