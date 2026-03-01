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
    "hidden" BOOLEAN NOT NULL DEFAULT false,
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
    "nifty500Momentum50NAV" REAL,
    "niftyMidcap100NAV" REAL,
    "niftySmallcap250NAV" REAL,
    "niftyMicrocap250NAV" REAL,
    "units" REAL NOT NULL,
    "cashflow" REAL,
    "drawdown" REAL,
    "dailyPnL" REAL,
    "dailyReturn" REAL,
    "navMA200" REAL
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
    "nanoCapPercent" REAL,
    "marketCap" REAL,
    "xirr" REAL,
    "pnl" REAL,
    "winPercent" REAL,
    "lossPercent" REAL,
    "avgHoldingPeriod" REAL,
    "avgWinnerGain" REAL,
    "avgLoserLoss" REAL
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
    "avgExitsPerMonth" REAL DEFAULT 0
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
CREATE TABLE "Cashflow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "MarketCapDefinition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "year" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "largeCapThreshold" REAL NOT NULL,
    "midCapThreshold" REAL NOT NULL,
    "smallCapThreshold" REAL NOT NULL,
    "microCapThreshold" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "CorporateAction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ratio" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'YAHOO'
);

-- CreateTable
CREATE TABLE "SymbolMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "oldSymbol" TEXT NOT NULL,
    "newSymbol" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orderId_key" ON "Transaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPortfolioSnapshot_date_key" ON "DailyPortfolioSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPortfolioSnapshot_date_key" ON "WeeklyPortfolioSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPortfolioSnapshot_date_key" ON "MonthlyPortfolioSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StockHistory_date_symbol_key" ON "StockHistory"("date", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCapDefinition_year_period_key" ON "MarketCapDefinition"("year", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAction_date_symbol_type_key" ON "CorporateAction"("date", "symbol", "type");

-- CreateIndex
CREATE UNIQUE INDEX "SymbolMapping_oldSymbol_key" ON "SymbolMapping"("oldSymbol");
