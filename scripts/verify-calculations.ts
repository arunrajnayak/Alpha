#!/usr/bin/env npx tsx
// ============================================================================
// verify-calculations.ts
//
// Verifies NAV (TWR), XIRR, and CAGR correctness for:
//   1. Pure delivery (buy-and-hold)
//   2. Swing trades (multi-day hold → sell)
//   3. Pure intraday (same-day buy+sell)
//   4. Delivery + intraday on same day
//   5. Mixed: delivery hold + swing exit + intraday
//   6. Intraday on day 1 followed by delivery on day 2
//   7. FIFO correctness for partial sell
//   8. Intraday loss (negative P&L)
//   9. XIRR consistency (incremental vs batch)
//  10. TWR capital-timing isolation
//
// Uses the real PortfolioEngine and xirr library from the project.
// Run: npx tsx scripts/verify-calculations.ts
// ============================================================================

import { PortfolioEngine } from '../src/lib/portfolio-engine';
import xirr from 'xirr';
import { differenceInDays } from 'date-fns';

// ──────────────────── Types ────────────────────

interface Transaction {
    symbol: string;
    type: string;
    quantity: number;
    price: number;
    date: Date;
    splitRatio?: number;
    newSymbol?: string;
}

interface DayConfig {
    date: Date;
    transactions: Transaction[];
    prices: Map<string, number>;
}

interface DayResult {
    date: Date;
    totalEquity: number;
    dailyNetFlow: number;
    displayCashflow: number;
    nav: number;
    dailyXirr: number | null;
    dailyCagr: number | null;
    dailyPnL: number;
    dailyRet: number;
    closedTrades: number;
    realizedPnl: number;
}

// ──────────────────── Simulation (mirrors recalculation.ts) ────────────────────

function simulate(days: DayConfig[]): DayResult[] {
    const engine = new PortfolioEngine();
    let nav = 100;
    let prevTotalEquity = 0;
    const xirrFlows: { amount: number; when: Date }[] = [];
    const results: DayResult[] = [];
    const portfolioStartDate = days[0].date;
    const lastKnownPrices = new Map<string, number>();

    for (const day of days) {
        engine.resetDailyFlow();
        let displayCashflow = 0;
        let closedTrades = 0;

        for (const tx of day.transactions) {
            if (tx.price > 0) lastKnownPrices.set(tx.symbol, tx.price);
            const result = engine.processTransaction(tx);

            if (tx.type === 'BUY') {
                displayCashflow -= tx.quantity * tx.price;
            } else if (tx.type === 'SELL') {
                displayCashflow += tx.quantity * tx.price;
            }

            if (result) closedTrades++;
        }

        for (const [sym, price] of day.prices) {
            lastKnownPrices.set(sym, price);
        }

        const valuation = engine.getValuation(lastKnownPrices);
        const totalEquity = valuation.totalEquity;
        const dailyNetFlow = engine.dailyNetFlow;

        // ── NAV (§D — post-fix) ──
        if (prevTotalEquity === 0) {
            if (dailyNetFlow > 0) {
                const dailyReturn = (totalEquity - dailyNetFlow) / dailyNetFlow;
                nav = 100 * (1 + dailyReturn);
            } else if (dailyNetFlow < 0 && totalEquity > 0) {
                const impliedCapital = -dailyNetFlow;
                const dailyReturn = totalEquity / impliedCapital - 1;
                nav = 100 * (1 + dailyReturn);
            } else {
                nav = 100;
            }
        } else {
            const adjustedEndValue = totalEquity - dailyNetFlow;
            const dailyReturn = adjustedEndValue / prevTotalEquity;
            nav = nav * dailyReturn;
            if (Number.isNaN(nav)) nav = 100;
        }

        // ── Daily P&L / Return ──
        let dailyPnL = 0;
        let dailyRet = 0;
        if (prevTotalEquity > 0) {
            dailyPnL = totalEquity - dailyNetFlow - prevTotalEquity;
            dailyRet = (totalEquity - dailyNetFlow) / prevTotalEquity - 1;
        } else if (dailyNetFlow > 0) {
            dailyPnL = totalEquity - dailyNetFlow;
            dailyRet = (totalEquity - dailyNetFlow) / dailyNetFlow;
        } else if (dailyNetFlow < 0 && totalEquity > 0) {
            const impliedCapital = -dailyNetFlow;
            dailyPnL = totalEquity - impliedCapital;
            dailyRet = totalEquity / impliedCapital - 1;
        }

        // ── XIRR Flows (§F1) ──
        if (Math.abs(displayCashflow) > 0) {
            xirrFlows.push({ amount: displayCashflow, when: new Date(day.date) });
        }

        // ── XIRR (§F2 — post-fix) ──
        let dailyXirr: number | null = null;
        if (xirrFlows.length > 0) {
            try {
                const flowsWithTerminal = [
                    ...xirrFlows,
                    { amount: totalEquity, when: new Date(day.date) }
                ];
                const rate = xirr(flowsWithTerminal);
                dailyXirr = rate;
            } catch {
                dailyXirr = null;
            }
        }

        // ── CAGR ──
        let dailyCagr: number | null = null;
        const daysElapsed = differenceInDays(day.date, portfolioStartDate);
        if (daysElapsed > 0 && nav > 0) {
            dailyCagr = Math.pow(nav / 100, 365 / daysElapsed) - 1;
        }

        results.push({
            date: day.date,
            totalEquity,
            dailyNetFlow,
            displayCashflow,
            nav,
            dailyXirr,
            dailyCagr,
            dailyPnL,
            dailyRet,
            closedTrades,
            realizedPnl: engine.realizedPnl,
        });

        prevTotalEquity = totalEquity;
    }

    return results;
}

// ──────────────────── Helpers ────────────────────

function d(dateStr: string): Date {
    return new Date(dateStr + 'T00:00:00.000Z');
}

function approxEq(a: number | null, b: number | null, tolerance = 0.02): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return Math.abs(a - b) < tolerance;
}

function fmt(v: number | null, dec = 2): string {
    if (v === null) return 'null';
    return v.toFixed(dec);
}

function pct(v: number | null): string {
    if (v === null) return 'null';
    return (v * 100).toFixed(2) + '%';
}

// ──────────────────── Test runner ────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, label: string, detail: string) {
    if (condition) {
        console.log(`    ✅ ${label}: ${detail}`);
        passed++;
    } else {
        console.log(`    ❌ ${label}: ${detail}`);
        failed++;
        failures.push(`${label}: ${detail}`);
    }
}

function section(title: string) {
    console.log(`\n${'═'.repeat(72)}`);
    console.log(`  ${title}`);
    console.log('═'.repeat(72));
}

// ============================================================================
//  SCENARIO 1: Pure Delivery — Buy and Hold
// ============================================================================

section('Scenario 1: Pure Delivery — Buy and Hold');
console.log('  BUY 100 RELIANCE @ ₹100 Day 1; hold as price → 105 → 110\n');

const s1 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'RELIANCE', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['RELIANCE', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [],
        prices: new Map([['RELIANCE', 105]])
    },
    {
        date: d('2026-01-07'),
        transactions: [],
        prices: new Map([['RELIANCE', 110]])
    },
]);

check(approxEq(s1[0].nav, 100), 'Day 1 NAV',
    `got ${fmt(s1[0].nav)}, expected 100.00`);
check(approxEq(s1[0].dailyPnL, 0), 'Day 1 P&L',
    `got ${fmt(s1[0].dailyPnL)}, expected 0.00`);
check(approxEq(s1[1].nav, 105), 'Day 2 NAV',
    `got ${fmt(s1[1].nav)}, expected 105.00`);
check(approxEq(s1[1].dailyPnL, 500), 'Day 2 P&L',
    `got ${fmt(s1[1].dailyPnL)}, expected 500.00`);
check(approxEq(s1[1].dailyRet, 0.05), 'Day 2 Return',
    `got ${pct(s1[1].dailyRet)}, expected 5.00%`);
check(approxEq(s1[2].nav, 110), 'Day 3 NAV',
    `got ${fmt(s1[2].nav)}, expected 110.00`);
check(s1[2].dailyXirr !== null && s1[2].dailyXirr > 0, 'Day 3 XIRR positive',
    `got ${pct(s1[2].dailyXirr)}`);

const expectedCagr1 = Math.pow(1.10, 365 / 2) - 1;
check(approxEq(s1[2].dailyCagr, expectedCagr1, 0.5), 'Day 3 CAGR',
    `got ${pct(s1[2].dailyCagr)}, expected ${pct(expectedCagr1)}`);

// ============================================================================
//  SCENARIO 2: Swing Trade — Buy, hold, sell
// ============================================================================

section('Scenario 2: Swing Trade — Buy, hold, sell');
console.log('  BUY 100 @ ₹100 Day 1; price 105 Day 2; SELL 100 @ ₹112 Day 3\n');

const s2 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'TCS', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['TCS', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [],
        prices: new Map([['TCS', 105]])
    },
    {
        date: d('2026-01-07'),
        transactions: [{ symbol: 'TCS', type: 'SELL', quantity: 100, price: 112, date: d('2026-01-07') }],
        prices: new Map([['TCS', 112]])
    },
]);

check(approxEq(s2[0].nav, 100), 'Day 1 NAV', `got ${fmt(s2[0].nav)}`);
check(approxEq(s2[1].nav, 105), 'Day 2 NAV', `got ${fmt(s2[1].nav)}`);

// Day 3 SELL: dailyNetFlow = −11200, equity = 0
//   adjustedEnd = 0 − (−11200) = 11200
//   NAV = 105 * (11200 / 10500) = 112
check(approxEq(s2[2].nav, 112), 'Day 3 NAV (sell day)',
    `got ${fmt(s2[2].nav)}, expected 112.00`);
check(approxEq(s2[2].dailyPnL, 700), 'Day 3 P&L',
    `got ${fmt(s2[2].dailyPnL)}, expected 700.00`);
check(approxEq(s2[2].totalEquity, 0, 1), 'Equity = 0 after exit',
    `got ${fmt(s2[2].totalEquity)}`);
check(approxEq(s2[2].realizedPnl, 1200), 'Realised P&L',
    `got ${fmt(s2[2].realizedPnl)}, expected 1200.00`);
check(s2[2].dailyXirr !== null && s2[2].dailyXirr > 0, 'XIRR positive',
    `got ${pct(s2[2].dailyXirr)}`);

// ============================================================================
//  SCENARIO 3: Pure Intraday — first-day buy+sell
// ============================================================================

section('Scenario 3: Pure Intraday — First day buy+sell');
console.log('  BUY 100 @ ₹100, SELL 100 @ ₹102 on Day 1.  Profit ₹200.\n');

const s3 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [
            { symbol: 'INFY', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') },
            { symbol: 'INFY', type: 'SELL', quantity: 100, price: 102, date: d('2026-01-05') },
        ],
        prices: new Map([['INFY', 102]])
    },
]);

check(approxEq(s3[0].totalEquity, 0, 1), 'Equity = 0 after close',
    `got ${fmt(s3[0].totalEquity)}`);
check(approxEq(s3[0].nav, 100), 'NAV = 100 (TWR: no equity to measure)',
    `got ${fmt(s3[0].nav)}`);
check(approxEq(s3[0].realizedPnl, 200), 'Realised P&L = ₹200',
    `got ${fmt(s3[0].realizedPnl)}`);
check(approxEq(s3[0].displayCashflow, 200), 'Display cashflow = +200',
    `got ${fmt(s3[0].displayCashflow)}`);
check(s3[0].dailyXirr === null, 'XIRR = null (no negative flow)',
    `got ${s3[0].dailyXirr === null ? 'null' : pct(s3[0].dailyXirr)}`);
check(s3[0].dailyCagr === null, 'CAGR = null (day 0)',
    `got ${s3[0].dailyCagr === null ? 'null' : pct(s3[0].dailyCagr)}`);

// ============================================================================
//  SCENARIO 4: Intraday after existing delivery portfolio
// ============================================================================

section('Scenario 4: Intraday after existing delivery');
console.log('  Day 1: BUY 100 A @ ₹100 (delivery)');
console.log('  Day 2: A still ₹100; BUY 50 B @ ₹200 + SELL 50 B @ ₹204 (intraday)\n');

const s4 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'A', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['A', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [
            { symbol: 'B', type: 'BUY', quantity: 50, price: 200, date: d('2026-01-06') },
            { symbol: 'B', type: 'SELL', quantity: 50, price: 204, date: d('2026-01-06') },
        ],
        prices: new Map([['A', 100], ['B', 204]])
    },
]);

// dailyNetFlow = +10000−10200 = −200; equity = 10000
// adjustedEnd = 10000+200 = 10200; return = 10200/10000 = 1.02; NAV = 102
check(approxEq(s4[1].nav, 102), 'Day 2 NAV = 102 (intraday ₹200 profit)',
    `got ${fmt(s4[1].nav)}`);
check(approxEq(s4[1].dailyPnL, 200), 'Day 2 P&L = ₹200',
    `got ${fmt(s4[1].dailyPnL)}`);
check(approxEq(s4[1].dailyRet, 0.02), 'Day 2 return = 2%',
    `got ${pct(s4[1].dailyRet)}`);
check(s4[1].dailyXirr !== null && s4[1].dailyXirr > 0, 'XIRR positive',
    `got ${pct(s4[1].dailyXirr)}`);

// ============================================================================
//  SCENARIO 5: Delivery price move + intraday profit, same day
// ============================================================================

section('Scenario 5: Delivery price move + intraday, same day');
console.log('  Day 1: BUY 100 A @ ₹100');
console.log('  Day 2: A → ₹105; BUY 50 B @ ₹200 SELL 50 B @ ₹204\n');

const s5 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'A', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['A', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [
            { symbol: 'B', type: 'BUY', quantity: 50, price: 200, date: d('2026-01-06') },
            { symbol: 'B', type: 'SELL', quantity: 50, price: 204, date: d('2026-01-06') },
        ],
        prices: new Map([['A', 105], ['B', 204]])
    },
]);

// A: +500 mark-to-market, B intraday: +200 → total +700 on 10000 = 7%
check(approxEq(s5[1].nav, 107), 'NAV = 107 (delivery +500 + intraday +200)',
    `got ${fmt(s5[1].nav)}`);
check(approxEq(s5[1].dailyPnL, 700), 'P&L = ₹700',
    `got ${fmt(s5[1].dailyPnL)}`);
check(approxEq(s5[1].dailyRet, 0.07), 'Return = 7%',
    `got ${pct(s5[1].dailyRet)}`);

// ============================================================================
//  SCENARIO 6: Mixed — delivery hold + swing exit + intraday
// ============================================================================

section('Scenario 6: Delivery + swing exit + intraday — same day');
console.log('  Day 1: BUY 100 A @ ₹100, BUY 50 B @ ₹200');
console.log('  Day 2: A=₹100, B=₹220');
console.log('  Day 3: A=₹102; SELL 50 B @ ₹220 (exit); BUY 30 C @50 SELL 30 C @52\n');

const s6 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [
            { symbol: 'A', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') },
            { symbol: 'B', type: 'BUY', quantity: 50, price: 200, date: d('2026-01-05') },
        ],
        prices: new Map([['A', 100], ['B', 200]])
    },
    {
        date: d('2026-01-06'),
        transactions: [],
        prices: new Map([['A', 100], ['B', 220]])
    },
    {
        date: d('2026-01-07'),
        transactions: [
            { symbol: 'B', type: 'SELL', quantity: 50, price: 220, date: d('2026-01-07') },
            { symbol: 'C', type: 'BUY', quantity: 30, price: 50, date: d('2026-01-07') },
            { symbol: 'C', type: 'SELL', quantity: 30, price: 52, date: d('2026-01-07') },
        ],
        prices: new Map([['A', 102], ['B', 220], ['C', 52]])
    },
]);

check(approxEq(s6[0].nav, 100), 'Day 1 NAV', `got ${fmt(s6[0].nav)}`);
check(approxEq(s6[1].nav, 105), 'Day 2 NAV (B up 10%)',
    `got ${fmt(s6[1].nav)}`);

// Day 3: A 100→102 (+200), B exit 220 (no change today), C intraday +60 = total +260
// dailyNetFlow = −11000+1500−1560 = −11060; equity = 10200
// adjustedEnd = 10200+11060 = 21260; return = 21260/21000 = 1.01238
const expectedNav6 = 105 * (21260 / 21000);
check(approxEq(s6[2].nav, expectedNav6, 0.1), 'Day 3 NAV',
    `got ${fmt(s6[2].nav)}, expected ${fmt(expectedNav6)}`);
check(approxEq(s6[2].dailyPnL, 260), 'Day 3 P&L = ₹260',
    `got ${fmt(s6[2].dailyPnL)}`);

// ============================================================================
//  SCENARIO 7: Intraday day 1 → delivery day 2
// ============================================================================

section('Scenario 7: Intraday day 1 → delivery day 2');
console.log('  Day 1: BUY 100 @ ₹100, SELL 100 @ ₹103 (intraday +₹300)');
console.log('  Day 2: BUY 200 @ ₹50 (delivery)');
console.log('  Day 3: price → ₹52\n');

const s7 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [
            { symbol: 'X', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') },
            { symbol: 'X', type: 'SELL', quantity: 100, price: 103, date: d('2026-01-05') },
        ],
        prices: new Map([['X', 103]])
    },
    {
        date: d('2026-01-06'),
        transactions: [
            { symbol: 'Y', type: 'BUY', quantity: 200, price: 50, date: d('2026-01-06') },
        ],
        prices: new Map([['Y', 50]])
    },
    {
        date: d('2026-01-07'),
        transactions: [],
        prices: new Map([['Y', 52]])
    },
]);

check(approxEq(s7[0].nav, 100), 'Day 1 NAV = 100 (intraday, no residual equity)',
    `got ${fmt(s7[0].nav)}`);
check(approxEq(s7[0].realizedPnl, 300), 'Day 1 realised P&L',
    `got ${fmt(s7[0].realizedPnl)}`);
check(approxEq(s7[1].nav, 100), 'Day 2 NAV = 100 (new delivery, no gain yet)',
    `got ${fmt(s7[1].nav)}`);
check(approxEq(s7[2].nav, 104), 'Day 3 NAV = 104 (delivery +4%)',
    `got ${fmt(s7[2].nav)}`);

// XIRR day 3: flows = [+300 day1, −10000 day2], terminal = 10400 day3
// net invested = 10000−300 = 9700 → got 10400 → captures intraday profit too
check(s7[2].dailyXirr !== null && s7[2].dailyXirr > 0, 'Day 3 XIRR includes day-1 intraday profit',
    `got ${pct(s7[2].dailyXirr)}`);

// ============================================================================
//  SCENARIO 8: FIFO partial sell
// ============================================================================

section('Scenario 8: FIFO partial sell');
console.log('  Day 1: BUY 100 @ ₹100; Day 5: BUY 50 @ ₹120; Day 10: SELL 80 @ ₹130\n');

const s8 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'Z', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['Z', 100]])
    },
    { date: d('2026-01-06'), transactions: [], prices: new Map([['Z', 102]]) },
    { date: d('2026-01-07'), transactions: [], prices: new Map([['Z', 105]]) },
    { date: d('2026-01-08'), transactions: [], prices: new Map([['Z', 110]]) },
    {
        date: d('2026-01-09'),
        transactions: [{ symbol: 'Z', type: 'BUY', quantity: 50, price: 120, date: d('2026-01-09') }],
        prices: new Map([['Z', 120]])
    },
    { date: d('2026-01-12'), transactions: [], prices: new Map([['Z', 122]]) },
    { date: d('2026-01-13'), transactions: [], prices: new Map([['Z', 125]]) },
    { date: d('2026-01-14'), transactions: [], prices: new Map([['Z', 128]]) },
    { date: d('2026-01-15'), transactions: [], prices: new Map([['Z', 130]]) },
    {
        date: d('2026-01-16'),
        transactions: [{ symbol: 'Z', type: 'SELL', quantity: 80, price: 130, date: d('2026-01-16') }],
        prices: new Map([['Z', 130]])
    },
]);

const sellDay = s8[9];

// FIFO: 80 from batch 1 (100 @ 100) → cost = 8000, revenue = 10400, P&L = 2400
check(approxEq(sellDay.realizedPnl, 2400), 'Realised P&L (FIFO)',
    `got ${fmt(sellDay.realizedPnl)}, expected 2400.00`);

// Remaining: 20 @ 100 + 50 @ 120 → 70 shares × 130 = 9100
check(approxEq(sellDay.totalEquity, 9100), 'Remaining equity',
    `got ${fmt(sellDay.totalEquity)}, expected 9100.00`);

check(sellDay.nav > 100, 'NAV > 100 (stock appreciated)',
    `got ${fmt(sellDay.nav)}`);

// ============================================================================
//  SCENARIO 9: Intraday loss
// ============================================================================

section('Scenario 9: Intraday loss');
console.log('  Day 1: BUY 100 A @ ₹100; Day 2: intraday B loss ₹200; A stays ₹100\n');

const s9 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'A', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['A', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [
            { symbol: 'B', type: 'BUY', quantity: 50, price: 200, date: d('2026-01-06') },
            { symbol: 'B', type: 'SELL', quantity: 50, price: 196, date: d('2026-01-06') },
        ],
        prices: new Map([['A', 100], ['B', 196]])
    },
]);

// dailyNetFlow = +10000−9800 = +200; equity = 10000
// adjustedEnd = 10000−200 = 9800; return = 9800/10000 = 0.98; NAV = 98
check(approxEq(s9[1].nav, 98), 'NAV = 98 (intraday loss)',
    `got ${fmt(s9[1].nav)}`);
check(approxEq(s9[1].dailyPnL, -200), 'P&L = −₹200',
    `got ${fmt(s9[1].dailyPnL)}`);
check(approxEq(s9[1].dailyRet, -0.02), 'Return = −2%',
    `got ${pct(s9[1].dailyRet)}`);

// ============================================================================
//  SCENARIO 10: XIRR consistency — recalc incremental vs holdings.ts batch
// ============================================================================

section('Scenario 10: XIRR consistency — incremental vs batch');
console.log('  Compare recalculation incremental XIRR ≈ holdings.ts all-at-once XIRR\n');

// Using Scenario 6's data
const s10txs: { amount: number; when: Date }[] = [
    { amount: -(100 * 100), when: d('2026-01-05') },
    { amount: -(50 * 200), when: d('2026-01-05') },
    { amount: (50 * 220), when: d('2026-01-07') },
    { amount: -(30 * 50), when: d('2026-01-07') },
    { amount: (30 * 52), when: d('2026-01-07') },
    { amount: 10200, when: d('2026-01-07') },  // terminal equity
];

let holdingsXirr: number | null = null;
try { holdingsXirr = xirr(s10txs); } catch { holdingsXirr = null; }
const recalcXirr = s6[2].dailyXirr;

if (holdingsXirr !== null && recalcXirr !== null) {
    check(approxEq(holdingsXirr, recalcXirr, 0.05),
        'Holdings XIRR ≈ Recalc XIRR',
        `holdings: ${pct(holdingsXirr)}, recalc: ${pct(recalcXirr)}`);
} else {
    check(holdingsXirr === null && recalcXirr === null,
        'Both XIRR null',
        `holdings: ${holdingsXirr}, recalc: ${recalcXirr}`);
}

// ============================================================================
//  SCENARIO 11: TWR isolates capital injection timing
// ============================================================================

section('Scenario 11: TWR isolates capital injection timing');
console.log('  Day 1: BUY 100 @ ₹100; Day 2: BUY 100 @ ₹105; Day 3: price ₹110');
console.log('  TWR should show the stock\'s pure market return, not capital timing.\n');

const s11 = simulate([
    {
        date: d('2026-01-05'),
        transactions: [{ symbol: 'A', type: 'BUY', quantity: 100, price: 100, date: d('2026-01-05') }],
        prices: new Map([['A', 100]])
    },
    {
        date: d('2026-01-06'),
        transactions: [{ symbol: 'A', type: 'BUY', quantity: 100, price: 105, date: d('2026-01-06') }],
        prices: new Map([['A', 105]])
    },
    {
        date: d('2026-01-07'),
        transactions: [],
        prices: new Map([['A', 110]])
    },
]);

check(approxEq(s11[0].nav, 100), 'Day 1 NAV', `got ${fmt(s11[0].nav)}`);

// Day 2: equity = 200×105 = 21000; flow = +10500
// adjustedEnd = 21000−10500 = 10500 (just original 100 shares at 105)
// return = 10500/10000 = 1.05; NAV = 105
check(approxEq(s11[1].nav, 105), 'Day 2 NAV = 105 (TWR ignores new capital)',
    `got ${fmt(s11[1].nav)}`);

// Day 3: equity = 200×110 = 22000; return = 22000/21000 = 1.0476; NAV = 110
check(approxEq(s11[2].nav, 110), 'Day 3 NAV = 110',
    `got ${fmt(s11[2].nav)}`);

const twrTotal = (s11[2].nav / 100) - 1;
check(approxEq(twrTotal, 0.10), 'Total TWR = stock\'s 10% market return',
    `got ${pct(twrTotal)}, expected 10.00%`);

// ============================================================================
//  Summary
// ============================================================================

console.log(`\n${'═'.repeat(72)}`);
if (failed === 0) {
    console.log(`  ✅ ALL ${passed} TESTS PASSED`);
} else {
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
}
console.log('═'.repeat(72));

if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
        console.log(`    ❌ ${f}`);
    }
}

process.exit(failed > 0 ? 1 : 0);
