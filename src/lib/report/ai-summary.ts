import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '@/lib/logger';
import type { ReportData, PortfolioHolding, ExitCandidate, WarnCandidate, EntryCandidate } from './types';

const aiLogger = logger.scope('ReportAI');

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Indian equity analyst & portfolio manager writing an executive daily review for a momentum investor. Use rich Markdown formatting including Markdown tables, subheaders (###), bullet lists, bold text, and callout quote blocks (>). Be specific: cite exact symbols, numbers, DMA breaches, and rank changes.

Structure your response into the following visual sections:

> **Executive Takeaway Callout**: A 1-2 sentence high-impact summary of today's key theme and required action.

### 📊 Performance & Market Snapshot
Include a clean Markdown Table comparing:
| Metric | Portfolio | Nifty 50 | Nifty 500 | Alpha vs Nifty |
|---|---|---|---|---|
Discuss:
1. Today's performance relative to benchmarks, total PnL (+32.62%), top contributor, and top drag.
2. A dedicated 2-3 sentence analysis on **multi-period performance trends**: compare how the portfolio is doing **YTD**, **last 1 month (1M)**, and **last 1 week (1W)** relative to **Nifty 50** and **Nifty 500** (cite exact % returns from the data).
3. A dedicated 1-2 sentence **Unique Portfolio Stat & Insight**: highlight 1-2 interesting stats from uniquePortfolioInsights (e.g. overall win rate % of profitable holdings, top winner vs loser overall PnL, stocks within 10% of ATH, or ASM surveillance density).
4. Sector rotation and market breadth (advances/declines).

### 🚨 Risk & Signal Analysis
Include a Markdown Table listing all Exit (🔴) and Warning (🟡) stocks:
| Symbol | Signal | Rank | Key Trigger / Reason | Action / Status |
|---|---|---|---|---|
Provide commentary on technical breaches:
- **EXIT (Red)**: Below 200 DMA & >25% ATH drawdown, rank >60, or dropped screener universe.
- **WARNING (Yellow)**: Below 50 DMA, rank 51–60, moved to BE category, or dropped > 20% from post-portfolio addition high.
- **ASM Surveillance**: Call out any stock on short/long-term surveillance (e.g. LT-1, LT-4).
- **Protected**: Note stocks held < 14 days (cannot be exited yet).

### 🚀 Opportunity & Deployment Candidates
Include a Markdown Table of top non-portfolio entry candidates:
| Rank | Symbol | Cap Category | From ATH | Status |
|---|---|---|---|---|
Highlight new entrants into top 30 filtered rankings for redeploying capital from exits.

### 💡 Closing Action Summary
One clear closing paragraph summarizing tomorrow's exact execution steps.`;

// ─── Input builder ────────────────────────────────────────────────────────────

function holdingSignalSummary(h: PortfolioHolding): string {
  const base = `${h.symbol}: day ${h.dayChangePercent >= 0 ? '+' : ''}${h.dayChangePercent.toFixed(2)}%, total PnL ${h.totalPnlPercent >= 0 ? '+' : ''}${h.totalPnlPercent.toFixed(2)}%, rank ${h.rank ?? 'unranked'}, signal=${h.signal}`;
  const parts = [base];
  if (h.signalReason)                         parts.push(`reason: ${h.signalReason}`);
  if (h.drawdownSinceEntry != null)            parts.push(`drawdown since entry: ${h.drawdownSinceEntry.toFixed(1)}%`);
  if (h.asmInfo)                              parts.push(`ASM surveillance: ${h.asmInfo.type}-${h.asmInfo.stage}`);
  return parts.join(' | ');
}

function exitSummary(e: ExitCandidate): string {
  const reasons: string[] = [];
  if (e.byFilter)   reasons.push('below 200 DMA / far from ATH');
  if (e.by50Dma && !e.byFilter) reasons.push('below 50 DMA');
  if (e.byDrawdown) reasons.push('dropped > 25% since entry');
  else if (e.byDrawdownWarn) reasons.push('dropped > 20% since entry');
  if (e.isBE)       reasons.push('moved to BE category');
  if (e.isUnranked && !e.isBE) reasons.push('dropped out of screener universe');
  if (e.byRank && e.rank != null && !e.isUnranked) reasons.push(`rank ${e.rank}`);
  return `${e.symbol} [EXIT${e.protected ? ' — PROTECTED' : ''}]: ${reasons.join(', ')}`;
}

function warnSummary(w: WarnCandidate): string {
  const reasons: string[] = [];
  if (w.by50Dma) reasons.push('below 50 DMA');
  if (w.byDrawdownWarn) reasons.push('dropped > 20% since entry');
  if (w.isBE)    reasons.push('moved to BE category');
  if (w.byRank && w.rank != null) reasons.push(`rank ${w.rank} (51–60 band)`);
  return `${w.symbol} [WARNING${w.protected ? ' — PROTECTED' : ''}]: ${reasons.join(', ')}`;
}

function entrySummary(e: EntryCandidate): string {
  return `#${e.rank} ${e.symbol}${e.isNewEntrant ? ' (NEW)' : ''} — ${e.marketCapCategory ?? 'unknown cap'}, ${(e.athProximityPct - 100).toFixed(1)}% from ATH`;
}

function buildSummaryInput(data: ReportData): string {
  const p = data.portfolio;
  const m = data.market;

  const sections: Record<string, unknown> = { date: data.date };

  // Portfolio overview
  if (p) {
    const nifty50 = p.benchmarks.find((b) => b.name === 'Nifty 50');
    const mom50   = p.benchmarks.find((b) => b.name.toLowerCase().includes('500'));
    sections.portfolio = {
      dayGainPercent:  `${p.dayGainPercent >= 0 ? '+' : ''}${p.dayGainPercent.toFixed(2)}%`,
      totalPnlPercent: `${p.totalPnlPercent >= 0 ? '+' : ''}${p.totalPnlPercent.toFixed(2)}%`,
      holdingsCount:   p.holdingsCount,
      signalCounts:    p.holdWarnExitCounts,
      alphaVsNifty50:  nifty50 != null ? `${(p.dayGainPercent - nifty50.changePercent) >= 0 ? '+' : ''}${(p.dayGainPercent - nifty50.changePercent).toFixed(2)}%` : 'N/A',
      topGainer:       p.topGainer ? `${p.topGainer.symbol} (${p.topGainer.changePercent >= 0 ? '+' : ''}${p.topGainer.changePercent.toFixed(2)}%)` : 'N/A',
      topLoser:        p.topLoser  ? `${p.topLoser.symbol} (${p.topLoser.changePercent.toFixed(2)}%)`  : 'N/A',
      benchmarks:      p.benchmarks.reduce((acc, b) => ({ ...acc, [b.name]: `${b.changePercent >= 0 ? '+' : ''}${b.changePercent.toFixed(2)}%` }), {} as Record<string, string>),
      nifty500:        mom50 ? `${mom50.changePercent >= 0 ? '+' : ''}${mom50.changePercent.toFixed(2)}%` : 'N/A',
      multiPeriodPerformance: p.multiPeriod ? {
        "1Week":  `Portfolio: ${p.multiPeriod.oneWeek.portfolio != null ? (p.multiPeriod.oneWeek.portfolio >= 0 ? '+' : '') + p.multiPeriod.oneWeek.portfolio.toFixed(2) + '%' : 'N/A'} | Nifty50: ${p.multiPeriod.oneWeek.nifty50 != null ? (p.multiPeriod.oneWeek.nifty50 >= 0 ? '+' : '') + p.multiPeriod.oneWeek.nifty50.toFixed(2) + '%' : 'N/A'} | Nifty500: ${p.multiPeriod.oneWeek.n500Mom50 != null ? (p.multiPeriod.oneWeek.n500Mom50 >= 0 ? '+' : '') + p.multiPeriod.oneWeek.n500Mom50.toFixed(2) + '%' : 'N/A'}`,
        "1Month": `Portfolio: ${p.multiPeriod.oneMonth.portfolio != null ? (p.multiPeriod.oneMonth.portfolio >= 0 ? '+' : '') + p.multiPeriod.oneMonth.portfolio.toFixed(2) + '%' : 'N/A'} | Nifty50: ${p.multiPeriod.oneMonth.nifty50 != null ? (p.multiPeriod.oneMonth.nifty50 >= 0 ? '+' : '') + p.multiPeriod.oneMonth.nifty50.toFixed(2) + '%' : 'N/A'} | Nifty500: ${p.multiPeriod.oneMonth.n500Mom50 != null ? (p.multiPeriod.oneMonth.n500Mom50 >= 0 ? '+' : '') + p.multiPeriod.oneMonth.n500Mom50.toFixed(2) + '%' : 'N/A'}`,
        "YTD":    `Portfolio: ${p.multiPeriod.ytd.portfolio != null ? (p.multiPeriod.ytd.portfolio >= 0 ? '+' : '') + p.multiPeriod.ytd.portfolio.toFixed(2) + '%' : 'N/A'} | Nifty50: ${p.multiPeriod.ytd.nifty50 != null ? (p.multiPeriod.ytd.nifty50 >= 0 ? '+' : '') + p.multiPeriod.ytd.nifty50.toFixed(2) + '%' : 'N/A'} | Nifty500: ${p.multiPeriod.ytd.n500Mom50 != null ? (p.multiPeriod.ytd.n500Mom50 >= 0 ? '+' : '') + p.multiPeriod.ytd.n500Mom50.toFixed(2) + '%' : 'N/A'}`,
      } : 'N/A',
      uniquePortfolioInsights: p.uniqueStats ? {
        winRate: `${p.uniqueStats.profitableCount} of ${p.uniqueStats.totalHoldingsCount} holdings (${p.uniqueStats.winRatePct.toFixed(1)}%) in overall profit`,
        todayBreadth: `${p.uniqueStats.advancingTodayCount} advancing vs ${p.uniqueStats.decliningTodayCount} declining today`,
        stocksNearAth: `${p.uniqueStats.nearAthCount} holdings trading within 10% of All-Time High`,
        asmSurveillanceCount: `${p.uniqueStats.asmSurveillanceCount} holdings under NSE ASM surveillance`,
        topOverallWinner: p.uniqueStats.topOverallWinner ? `${p.uniqueStats.topOverallWinner.symbol} (+${p.uniqueStats.topOverallWinner.totalPnlPercent.toFixed(1)}% total PnL)` : 'N/A',
        topOverallLoser: p.uniqueStats.topOverallLoser ? `${p.uniqueStats.topOverallLoser.symbol} (${p.uniqueStats.topOverallLoser.totalPnlPercent.toFixed(1)}% total PnL)` : 'N/A',
      } : 'N/A',
    };
  }

  // Per-holding detail (all portfolio stocks, sorted by day change)
  if (data.holdings.length > 0) {
    sections.holdings = data.holdings.map(holdingSignalSummary);
  }

  // Market
  if (m) {
    sections.market = {
      topSectors:    m.topSectors.map((s)    => `${s.shortName} (${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%)`),
      bottomSectors: m.bottomSectors.map((s) => `${s.shortName} (${s.changePercent.toFixed(2)}%)`),
      breadth: {
        nifty50:     m.nifty50     ? `${m.nifty50.advancing} adv / ${m.nifty50.declining} dec / ${m.nifty50.unchanged} unch` : 'N/A',
        totalMarket: m.totalMarket ? `${m.totalMarket.advancing} adv / ${m.totalMarket.declining} dec / ${m.totalMarket.unchanged} unch` : 'N/A',
      },
      topGainers: m.topGainers.map((g) => `${g.symbol} (${g.changePercent >= 0 ? '+' : ''}${g.changePercent.toFixed(2)}%)`),
      topLosers:  m.topLosers.map((g)  => `${g.symbol} (${g.changePercent.toFixed(2)}%)`),
    };
  }

  // Exit signals
  sections.exitSignals = data.exits.length > 0
    ? data.exits.map(exitSummary)
    : 'None';

  // Warning signals
  sections.warningSignals = data.warnings.length > 0
    ? data.warnings.map(warnSummary)
    : 'None';

  // Entry candidates (top 5 non-portfolio)
  sections.entryCandidates = data.entries.slice(0, 5).map(entrySummary);

  return JSON.stringify(sections, null, 2);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAISummary(data: ReportData): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const modelName = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
  aiLogger.info(`Requesting AI summary from Gemini (${modelName})...`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
  });

  const prompt = `Here is today's portfolio and market data. Write the analyst summary:\n\n${buildSummaryInput(data)}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 1800,
      temperature: 0.3,
    },
  });

  const text = result.response.text().trim();
  aiLogger.info(`AI summary generated (${text.length} chars)`);
  return text;
}
