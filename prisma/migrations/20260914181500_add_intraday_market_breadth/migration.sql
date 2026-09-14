-- CreateTable
CREATE TABLE IF NOT EXISTS "IntradayMarketBreadth" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" TEXT NOT NULL,
    "advances" INTEGER NOT NULL,
    "declines" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "adRatio" REAL NOT NULL,
    "netAdvances" INTEGER NOT NULL,
    "largeAdv" INTEGER,
    "largeDec" INTEGER,
    "midAdv" INTEGER,
    "midDec" INTEGER,
    "smallAdv" INTEGER,
    "smallDec" INTEGER,
    "microAdv" INTEGER,
    "microDec" INTEGER
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntradayMarketBreadth_date_idx" ON "IntradayMarketBreadth"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntradayMarketBreadth_timestamp_idx" ON "IntradayMarketBreadth"("timestamp");
