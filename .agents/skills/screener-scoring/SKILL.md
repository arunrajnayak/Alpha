---
name: screener-scoring
description: Guide to understanding and modifying the momentum screener scoring formula in Alpha Portfolio Tracker. Use when changing scoring weights, filters, lookback windows, or exit signal logic. IMPORTANT — the formula must stay in sync with the Python backtest engine.
---

# Momentum Screener Scoring

> [!CAUTION]
> The screener formula in `src/lib/screener/scoring.ts` MUST stay numerically identical to the Python backtest engine. Any change here must be replicated in the backtest engine and vice versa.

## Formula

File: `src/lib/screener/scoring.ts`

```
Composite Score = mean(Sharpe_12m, Sharpe_6m, Sharpe_3m)

For each window:
  Sharpe = (mean_daily_return × 252) / (sample_std × √252)
  Risk-free rate = 0
  ddof = 1 (sample standard deviation)
```

### Lookback windows
| Period | Trading days | End date |
|--------|-------------|----------|
| 12m | 252 | Today |
| 6m | 126 | Today |
| 3m | 62 | 21 days ago |

The 3m window skips the last 21 days to reduce mean reversion noise.

## Pipeline orchestration

File: `src/lib/screener/pipeline.ts`

```
daily cron (4:30 PM IST weekdays)
   ↓
ingestPrices()      ← fetch yesterday's OHLCV from Upstox → ScreenerPrice table
   ↓
updateATH()         ← update StockATH from new candles
   ↓
updateBhavcopy()    ← fetch NSE market caps → StockMarketCap
   ↓
scoreAndRank()      ← compute Sharpe, apply filters, rank all stocks
   ↓
saveScores()        ← upsert MomentumScore (today's computedDate)
   ↓
saveRankingHistory()← append to RankingHistory (50-day rolling window)
```

## Entry filters (ALL must pass for Pre-filtered tab; All tab has no market cap or entry filters)

| Filter | Value | Source |
|--------|-------|--------|
| Market cap | ≥ ₹1,000 Cr (Pre-filtered only) | `StockMarketCap` (bhavcopy) |
| Price | ≥ ₹50 | Latest close |
| Price exemption | GOLDBEES, SILVERBEES | Hardcoded |
| Above 200 DMA | close ≥ SMA(200) | `ScreenerPrice` |
| ATH proximity | close ≥ 70% × ATH | `StockATH` |
| Turnover | median(close × volume, 126d) ≥ ₹1 Cr | `ScreenerPrice` |
| Circuit band | ≥ 9% (5% circuit tagged Caution) | NSE instrument data |
| Series | EQ & BE included (BE tagged Caution) | Instrument master |
| Data history | ≥ 269 trading days | `ScreenerPrice` row count |

## Exit & Warning Signal Logic (src/app/actions/screener.ts)

A portfolio holding is evaluated daily against three potential signal conditions:

- **`byRank`**: Stock is unranked OR its rank is $> 50$.
- **`byFilter`**: Close is below 200 DMA **OR** close is $> 25\%$ below ATH (`athProximity < 0.75`).
- **`by50Dma`**: Close is below the 50-day Simple Moving Average (50 DMA).

### 🔴 Red (Exit Signal)
A holding triggers a Red Exit Signal if:
- **Major filter breach** (`byFilter` is true).
- **Major rank drop**: Stock's rank is $> 60$.
- **Major drawdown**: Dropped $> 25\%$ from peak since entry.
- **Fell out of universe**: Stock is unranked for reasons other than being in the BE category.

### 🟡 Yellow (Warning Signal)
A holding triggers a Yellow Warning Signal if it does not meet the Red criteria, but satisfies:
- **DMA breach**: Close is below 50 DMA (`by50Dma` is true).
- **Moderate rank drop**: Stock's rank is between 51 and 60.
- **BE Category**: Stock belongs to the Trade-to-Trade (BE) category (ranked $\le 60$).
- **Moderate drawdown**: Dropped between 20% and 25% from peak since entry.

### 🔒 Min Hold Protection (Lock)
```typescript
const ageDays     = holdingAgeDays.get(row.symbol) ?? 9999;
const isProtected = ageDays < 14;
```
If a stock is held for **$< 14$ days**, its exit/warning signal is ignored and displays as locked (yellow lock icon in UI) to prevent premature exits.

## Modifying filters

1. Change the filter value in `src/lib/screener/scoring.ts` → `applyFilters()`
2. Update the filter table in `README.md` → Momentum Screener section
3. Re-run the pipeline to apply: `npx tsx scripts/run-pipeline.ts`
4. If the change is significant, backfill history: `npx tsx src/scripts/backfill-rank-history.ts`
