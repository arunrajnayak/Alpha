-- Add nanocap columns to snapshot and breadth tables
-- WeeklyPortfolioSnapshot
ALTER TABLE "WeeklyPortfolioSnapshot" ADD COLUMN "nanoCapPercent" REAL;

-- MonthlyPortfolioSnapshot
ALTER TABLE "MonthlyPortfolioSnapshot" ADD COLUMN "nanoCapPercent" REAL;

-- MarketBreadthIntraday
ALTER TABLE "IntradayMarketBreadth" ADD COLUMN "nanoAdv" INTEGER;
ALTER TABLE "IntradayMarketBreadth" ADD COLUMN "nanoDec" INTEGER;
