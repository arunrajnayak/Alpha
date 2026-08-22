# Alpha Portfolio Tracker — Claude Code Project Memory

## What this project is
A self-hosted Next.js 16 (App Router) portfolio tracker for Indian equities. Uses Upstox API for real-time/historical market data and Turso (libSQL/SQLite) as the database via Prisma with the libsql driver adapter.

## Critical rules before writing any code

1. **Database**: Always use Prisma via `import { prisma } from '@/lib/db'`. Never use raw SQL or `@libsql/client` directly in app code. The `prisma` instance is a singleton that handles Turso connection.
2. **Server-only**: All DB access, Upstox calls, and secrets must be in Server Actions (`'use server'`), API routes, or files tagged with `import 'server-only'`. Never expose secrets to client components.
3. **IST dates**: All market-related dates are in IST (Asia/Kolkata). Use helpers from `src/lib/tz.ts` and `src/lib/screener/dates.ts`. Never use `new Date()` raw for market logic.
4. **Lint before finishing**: Always run `npm run lint` and fix all issues before completing any task.
5. **Debugging**: Use the PRODUCTION database (`DATABASE_URL` in `.env.local` pointing to Turso). The local `prisma/dev.db` / `prisma/test.db` files contain only dummy data.
6. **Schema changes**: After modifying `prisma/schema.prisma`, run `npx prisma generate`. To push schema changes to Turso, run `npx tsx scripts/apply-turso-schema.ts` (NOT `prisma db push`, which doesn't work with libsql migrations in production).
7. **No Postgres**: This project migrated from Neon Postgres to Turso (libSQL/SQLite). Do NOT use Postgres-specific SQL syntax, `PrismaPg`, or `@neondatabase/serverless` in app code.

## Tech stack
- **Framework**: Next.js 16 App Router with Turbopack
- **Database**: Turso (libSQL/SQLite) via `@prisma/adapter-libsql`
- **ORM**: Prisma 7 (sqlite provider)
- **Market data**: Upstox API — REST for historical/screener, WebSocket (Protobuf v3) for live prices
- **Styling**: TailwindCSS v4 + Material UI v6
- **Charts**: Recharts, Nivo (treemap, pie)
- **Mobile**: Capacitor 8 (Android wrapper)
- **Runtime scripts**: `tsx` (TypeScript execute)

## Project structure — key files

```
src/
├── app/
│   ├── actions/           # Server Actions — import these in pages/components
│   │   ├── actions.ts     # Core portfolio: recalculate, snapshots, revalidation
│   │   ├── screener.ts    # Screener data fetch + exit signal detection
│   │   ├── live.ts        # Live dashboard: holdings, intraday P/L
│   │   ├── settings.ts    # Data lock, config, AMFI upload
│   │   ├── amfi.ts        # AMFI PDF parsing and classification
│   │   └── sectors.ts     # Sector mapping
│   ├── api/
│   │   ├── cron/          # All cron endpoints (auth via CRON_SECRET)
│   │   │   ├── intraday-pnl/   # Every-minute P/L recording
│   │   │   ├── momentum-screener/ # Daily screener pipeline
│   │   │   ├── corporate-actions/ # NSE split/bonus sync
│   │   │   ├── sector-refresh/  # Zerodha sector scrape
│   │   │   ├── amfi-sync/       # Market cap classification sync
│   │   │   ├── sync-orders/     # Dispatches GH Action for Zerodha sync
│   │   │   └── daily-report/    # Email report (Resend + optional Groq)
│   │   ├── portfolio/snapshot/  # Snapshot generation (daily/weekly/monthly)
│   │   ├── stream/market/       # Upstox WebSocket proxy/state
│   │   └── recompute/           # Full portfolio recalculation trigger
│   ├── live/              # Real-time dashboard page
│   ├── dashboard/         # Historical performance dashboard
│   ├── screener/          # Momentum screener page
│   ├── trades/            # Trade management & import
│   └── settings/          # Settings page
├── lib/
│   ├── db.ts              # Prisma singleton — USE THIS for all DB access
│   ├── config.ts          # DATA_LOCK_DATE, APP config from env/DB
│   ├── cron-auth.ts       # verifyCronSecret() — add to all cron routes
│   ├── upstox/            # Upstox REST client and token management
│   ├── upstox-client.ts   # Full Upstox SDK wrapper (quotes, history, instruments)
│   ├── finance/
│   │   ├── holdings.ts    # Current portfolio holdings + live prices
│   │   ├── recalculation.ts # Full portfolio history recalc engine
│   │   └── stock-history.ts # Historical price fetcher (Upstox)
│   ├── screener/
│   │   ├── pipeline.ts    # Orchestrates daily screener run
│   │   ├── scoring.ts     # Sharpe + composite score formula
│   │   ├── prices.ts      # Incremental candle ingestion
│   │   └── ath.ts         # All-time high tracking
│   ├── portfolio-engine.ts # Transaction processor — builds holding state
│   ├── import-service.ts  # Excel/CSV trade import + deduplication
│   ├── kite-client.ts     # Zerodha Kite Connect client (Puppeteer login)
│   └── report/
│       ├── gather-data.ts # Assembles report data
│       ├── ai-summary.ts  # Groq API for AI narrative
│       └── email-template.ts # HTML email builder
```

## Database schema summary

**Core**: `Transaction`, `ImportBatch`
**Snapshots**: `DailyPortfolioSnapshot`, `WeeklyPortfolioSnapshot`, `MonthlyPortfolioSnapshot`
**Price data**: `StockHistory`, `IndexHistory`, `IntradayPnL`
**Screener**: `ScreenerPrice`, `StockATH`, `MomentumScore`, `RankingHistory`, `StockMarketCap`, `ScreenerDemerger`
**Classification**: `AMFIClassification`, `AMFIImportHistory`, `SectorMapping`
**Auth/Config**: `UpstoxToken`, `AppConfig`, `SymbolMapping`, `Job`
**Finance**: `Dividend`

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Turso `libsql://` URL (or use `TURSO_DATABASE_URL` if via Vercel Marketplace) |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `UPSTOX_ANALYTICS_TOKEN` | Upstox read-only token (1-year) |
| `CRON_SECRET` | Secures all `/api/cron/*` endpoints |
| `GITHUB_PAT` | GitHub PAT (`workflow` scope) for Zerodha sync dispatch |
| `RESEND_API_KEY` | Email reports |
| `REPORT_EMAIL_TO` | Email report recipient |
| `GROQ_API_KEY` | AI summary in email reports |
| `ZERODHA_*` | Kite credentials for order sync |

## Common tasks

### Add a new cron endpoint
1. Create `src/app/api/cron/<name>/route.ts`
2. Import and call `verifyCronSecret(request)` at the top of the GET handler
3. Add `export const dynamic = 'force-dynamic'`
4. Add the endpoint to the cron-job.org table in README

### Add a new Server Action
1. Add `'use server'` at the top
2. Import `{ prisma }` from `@/lib/db`
3. Use `revalidatePath()` or `revalidateTag()` after mutations
4. Call it directly from Server or Client components

### Schema migration
```bash
# 1. Edit prisma/schema.prisma
# 2. Create a migration
npx prisma migrate dev --name describe_change
# 3. Apply to Turso
npx tsx scripts/apply-turso-schema.ts
# 4. Regenerate client
npx prisma generate
```

### Run the momentum screener locally
```bash
npx tsx scripts/run-pipeline.ts
```

### Test the Zerodha sync locally
```bash
npx tsx src/scripts/zerodha-cron.ts
```

## IST date conventions
- Market open: 09:15 IST, regular close: 15:30 IST, closing auction: 15:30–15:40 IST (market session close: 15:40 IST)
- All snapshot dates are stored as UTC midnight of the IST date (`YYYY-MM-DDT00:00:00.000Z`)
- Use `getISTDateString()` from `src/lib/screener/dates.ts` for YYYY-MM-DD strings
- The cron schedule `30 10 * * 1-5` = 4:00 PM IST (UTC+5:30)

## Known gotchas
- **Vercel + WebSocket**: Upstox WebSocket connects from the **browser**, not Vercel. Serverless functions can't hold persistent WebSocket connections.
- **libsql URL**: The app converts `libsql://` → `https://` internally for HTTP transport (required by Vercel Serverless). Don't set `https://` directly.
- **SQLite IN clause**: Limit large IN clauses to 500 items (`SQLITE_IN_CLAUSE_LIMIT` from `@/lib/db`). Use `chunkArray()` for batching.
- **`prisma/dev.db`**: Local dummy data only. Always debug against Turso (production DB).
- **Screener first run**: Requires 30-45 min backfill before the screener page shows data. See README Step 8.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
