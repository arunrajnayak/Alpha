import type { ReportData, SectorPerf, TopMover, ExitCandidate, WarnCandidate, EntryCandidate } from './types';

// ── Formatters ───────────────────────────────────────────────────────────────

function pct(val: number, decimals = 2): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(decimals)}%`;
}

function gain(val: number): string {
  return `<span style="color:${val >= 0 ? '#34d399' : '#f87171'};font-weight:600;">${pct(val)}</span>`;
}

// ── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:        '#0d1117',
  surface:   '#161b22',
  border:    '#21262d',
  muted:     '#8b949e',
  text:      '#e6edf3',
  textDim:   '#c9d1d9',
  green:     '#34d399',
  red:       '#f87171',
  amber:     '#fbbf24',
  purple:    '#a78bfa',
  blue:      '#60a5fa',
  accent:    '#238636',
};

// ── Shared snippets ──────────────────────────────────────────────────────────

const font = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;

function card(content: string, extraStyle = ''): string {
  return `<div style="background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:20px 24px;margin-bottom:12px;${extraStyle}">${content}</div>`;
}

function sectionLabel(text: string): string {
  return `<p style="margin:0 0 14px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${text}</p>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${C.border};margin:14px 0;">`;
}

function pill(text: string, bg: string, color = '#fff'): string {
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.5px;">${text}</span>`;
}

function statRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:7px 0;font-size:13px;color:${C.muted};width:50%;">${label}</td>
    <td style="padding:7px 0;font-size:13px;text-align:right;">${value}</td>
  </tr>`;
}

// ── Markdown Parser for Email ────────────────────────────────────────────────

function markdownToEmailHtml(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const htmlBlocks: string[] = [];

  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];

  let inList = false;
  let listItems: string[] = [];

  const formatInline = (text: string): string => {
    return text
      .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${C.text};font-weight:600;">$1</strong>`)
      .replace(/\*(.*?)\*/g, `<em>$1</em>`)
      .replace(/`([^`]+)`/g, `<code style="background:${C.border};color:${C.amber};padding:2px 5px;border-radius:4px;font-size:11px;">$1</code>`);
  };

  const flushList = () => {
    if (inList && listItems.length > 0) {
      htmlBlocks.push(
        `<ul style="margin:8px 0 12px 0;padding-left:18px;">${listItems
          .map(item => `<li style="margin:4px 0;font-size:13px;color:${C.textDim};line-height:1.6;">${formatInline(item)}</li>`)
          .join('')}</ul>`
      );
      listItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (inTable) {
      let tHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0;background:${C.bg};border:1px solid ${C.border};border-radius:6px;overflow:hidden;">`;
      if (tableHeader.length > 0) {
        tHtml += `<thead><tr style="background:#1c2128;">${tableHeader
          .map(h => `<th style="padding:8px 10px;font-size:11px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ${C.border};text-align:left;">${formatInline(h)}</th>`)
          .join('')}</tr></thead>`;
      }
      tHtml += `<tbody>`;
      tableRows.forEach(row => {
        tHtml += `<tr>${row
          .map(cell => `<td style="padding:8px 10px;font-size:12px;color:${C.textDim};border-bottom:1px solid ${C.border};">${formatInline(cell)}</td>`)
          .join('')}</tr>`;
      });
      tHtml += `</tbody></table>`;
      htmlBlocks.push(tHtml);
      tableHeader = [];
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Table row
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue; // skip separator row
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Callout quote
    if (line.startsWith('>')) {
      flushList();
      const content = formatInline(line.replace(/^>\s*/, ''));
      htmlBlocks.push(
        `<div style="background:#161b22;border-left:3px solid ${C.blue};padding:12px 16px;margin:14px 0;border-radius:0 8px 8px 0;font-size:13px;line-height:1.6;color:${C.text};">${content}</div>`
      );
      continue;
    }

    // Headers
    if (line.startsWith('###')) {
      flushList();
      const title = formatInline(line.replace(/^###\s*/, ''));
      htmlBlocks.push(`<h3 style="margin:18px 0 8px 0;font-size:14px;font-weight:700;color:${C.text};letter-spacing:0.5px;">${title}</h3>`);
      continue;
    }
    if (line.startsWith('##')) {
      flushList();
      const title = formatInline(line.replace(/^##\s*/, ''));
      htmlBlocks.push(`<h2 style="margin:22px 0 10px 0;font-size:16px;font-weight:700;color:${C.text};border-bottom:1px solid ${C.border};padding-bottom:6px;">${title}</h2>`);
      continue;
    }

    // List item
    if (/^[-*]\s/.test(line)) {
      inList = true;
      listItems.push(line.replace(/^[-*]\s+/, ''));
      continue;
    } else if (inList) {
      flushList();
    }

    // Paragraph
    if (line.length > 0) {
      htmlBlocks.push(`<p style="margin:0 0 10px 0;font-size:13.5px;line-height:1.7;color:${C.textDim};">${formatInline(line)}</p>`);
    }
  }

  flushList();
  flushTable();

  return htmlBlocks.join('');
}

// ── Section: AI Commentary ───────────────────────────────────────────────────

function renderAISummary(summary: string | null): string {
  if (!summary) return '';
  return card(`
    ${sectionLabel('Executive AI Commentary')}
    ${markdownToEmailHtml(summary)}
  `);
}

// ── Section: Portfolio ───────────────────────────────────────────────────────

function renderPortfolio(p: ReportData['portfolio']): string {
  if (!p) {
    return card(`${sectionLabel('Portfolio')}<p style="color:${C.muted};font-size:13px;margin:0;">Data unavailable</p>`);
  }

  const dayColor = p.dayGainPercent >= 0 ? C.green : C.red;
  const arrow    = p.dayGainPercent >= 0 ? '▲' : '▼';

  // Alpha vs Nifty 50
  const nifty50 = p.benchmarks.find((b) => b.name === 'Nifty 50');
  const alpha   = nifty50 != null ? p.dayGainPercent - nifty50.changePercent : null;

  // Benchmark grid — 2 columns
  const bCells = p.benchmarks.map((b) => `
    <td style="width:50%;padding:8px 10px;">
      <p style="margin:0 0 2px 0;font-size:11px;color:${C.muted};">${b.name}</p>
      <p style="margin:0;font-size:15px;font-weight:600;color:${b.changePercent >= 0 ? C.green : C.red};">${pct(b.changePercent)}</p>
    </td>`);

  // Chunk into rows of 2
  const bRows = [];
  for (let i = 0; i < bCells.length; i += 2) {
    const pair = bCells.slice(i, i + 2);
    if (pair.length === 1) pair.push(`<td style="width:50%;padding:8px 10px;"></td>`);
    bRows.push(`<tr>${pair.join('')}</tr>`);
  }

  return card(`
    ${sectionLabel('Portfolio')}

    <!-- Hero metric -->
    <div style="margin-bottom:18px;">
      <div style="font-size:40px;font-weight:700;color:${dayColor};line-height:1;margin-bottom:4px;">${arrow} ${Math.abs(p.dayGainPercent).toFixed(2)}%</div>
      ${alpha != null ? `<div style="font-size:12px;color:${C.muted};">${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}% vs Nifty 50</div>` : ''}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0">
      ${p.topGainer ? statRow('Best today',  `${p.topGainer.symbol} &nbsp;${gain(p.topGainer.changePercent)}`) : ''}
      ${p.topLoser  ? statRow('Worst today', `${p.topLoser.symbol} &nbsp;${gain(p.topLoser.changePercent)}`) : ''}
    </table>

    ${p.multiPeriod ? `${divider()}
    ${sectionLabel('Multi-Period Performance')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px;">
      <thead>
        <tr style="border-bottom:1px solid ${C.border};">
          <th style="padding:6px 0;font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;text-align:left;">Period</th>
          <th style="padding:6px 0;font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;text-align:right;">Portfolio</th>
          <th style="padding:6px 0;font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;text-align:right;">Nifty 50</th>
          <th style="padding:6px 0;font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;text-align:right;">Nifty 500</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:${C.textDim};">1-Week</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneWeek.portfolio != null ? gain(p.multiPeriod.oneWeek.portfolio) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneWeek.nifty50 != null ? gain(p.multiPeriod.oneWeek.nifty50) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneWeek.n500Mom50 != null ? gain(p.multiPeriod.oneWeek.n500Mom50) : '-'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:${C.textDim};">1-Month</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneMonth.portfolio != null ? gain(p.multiPeriod.oneMonth.portfolio) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneMonth.nifty50 != null ? gain(p.multiPeriod.oneMonth.nifty50) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.oneMonth.n500Mom50 != null ? gain(p.multiPeriod.oneMonth.n500Mom50) : '-'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:${C.textDim};">YTD</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.ytd.portfolio != null ? gain(p.multiPeriod.ytd.portfolio) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.ytd.nifty50 != null ? gain(p.multiPeriod.ytd.nifty50) : '-'}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">${p.multiPeriod.ytd.n500Mom50 != null ? gain(p.multiPeriod.ytd.n500Mom50) : '-'}</td>
        </tr>
      </tbody>
    </table>` : ''}

    ${p.uniqueStats ? `${divider()}
    ${sectionLabel('Portfolio Insights')}
    <table width="100%" cellpadding="0" cellspacing="0">
      ${statRow('Profitable Holdings', `<span style="color:${C.text};font-weight:600;">${p.uniqueStats.profitableCount} / ${p.uniqueStats.totalHoldingsCount} (${p.uniqueStats.winRatePct.toFixed(0)}% win rate)</span>`)}
      ${statRow('Near ATH (<10% ATH)', `<span style="color:${C.blue};font-weight:600;">${p.uniqueStats.nearAthCount} holdings</span>`)}
      ${p.uniqueStats.topOverallWinner ? statRow('Top All-Time Winner', `${p.uniqueStats.topOverallWinner.symbol} &nbsp;${gain(p.uniqueStats.topOverallWinner.totalPnlPercent)}`) : ''}
      ${p.uniqueStats.topOverallLoser ? statRow('Top All-Time Drag', `${p.uniqueStats.topOverallLoser.symbol} &nbsp;${gain(p.uniqueStats.topOverallLoser.totalPnlPercent)}`) : ''}
    </table>` : ''}

    ${bRows.length ? `${divider()}
    ${sectionLabel('Benchmarks')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${bRows.join('')}
    </table>` : ''}
  `);
}

// ── Section: Market ──────────────────────────────────────────────────────────

function renderSectors(top: SectorPerf[], bottom: SectorPerf[]): string {
  const row = (s: SectorPerf) => `
    <tr>
      <td style="padding:7px 0;font-size:13px;color:${C.textDim};">${s.shortName}</td>
      <td style="padding:7px 0;font-size:13px;text-align:right;">${gain(s.changePercent)}</td>
    </tr>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:50%;padding-right:10px;vertical-align:top;">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${C.green};">Top Sectors</p>
          <table width="100%" cellpadding="0" cellspacing="0">${top.map(row).join('')}</table>
        </td>
        <td style="width:50%;padding-left:10px;vertical-align:top;border-left:1px solid ${C.border};">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${C.red};">Weak Sectors</p>
          <table width="100%" cellpadding="0" cellspacing="0">${bottom.map(row).join('')}</table>
        </td>
      </tr>
    </table>`;
}

function renderMovers(gainers: TopMover[], losers: TopMover[]): string {
  const row = (m: TopMover) => `
    <tr>
      <td style="padding:5px 0;font-size:12px;color:${C.textDim};">${m.symbol}</td>
      <td style="padding:5px 0;font-size:12px;text-align:right;">${gain(m.changePercent)}</td>
    </tr>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:50%;padding-right:10px;vertical-align:top;">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${C.green};">Top 5 Gainers</p>
          <table width="100%" cellpadding="0" cellspacing="0">${gainers.map(row).join('')}</table>
        </td>
        <td style="width:50%;padding-left:10px;vertical-align:top;border-left:1px solid ${C.border};">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${C.red};">Top 5 Losers</p>
          <table width="100%" cellpadding="0" cellspacing="0">${losers.map(row).join('')}</table>
        </td>
      </tr>
    </table>`;
}

function adBar(label: string, adv: number, dec: number, unch: number): string {
  const total  = adv + dec + unch || 1;
  const advPct = ((adv / total) * 100).toFixed(0);
  const decPct = ((dec / total) * 100).toFixed(0);
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
      <tr>
        <td style="font-size:12px;color:${C.muted};padding-bottom:4px;">${label}</td>
        <td style="font-size:12px;text-align:right;padding-bottom:4px;white-space:nowrap;">
          <span style="color:${C.green};">${adv}↑</span>
          <span style="color:${C.muted};padding:0 3px;">·</span>
          <span style="color:${C.red};">${dec}↓</span>
          <span style="color:${C.muted};padding:0 3px;">·</span>
          <span style="color:${C.muted};">${unch}→</span>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.border};border-radius:4px;height:6px;overflow:hidden;">
            <tr>
              <td style="width:${advPct}%;background:${C.green};height:6px;font-size:0;">&nbsp;</td>
              <td style="width:${decPct}%;background:${C.red};height:6px;font-size:0;">&nbsp;</td>
              <td style="background:${C.border};height:6px;font-size:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function renderMarket(m: ReportData['market']): string {
  if (!m) {
    return card(`${sectionLabel('Market')}<p style="color:${C.muted};font-size:13px;margin:0;">Data unavailable</p>`);
  }

  const adSection = (m.totalMarket || m.nifty50) ? `
    ${divider()}
    ${sectionLabel('Advance / Decline')}
    ${m.totalMarket ? adBar('Nifty Total Market', m.totalMarket.advancing, m.totalMarket.declining, m.totalMarket.unchanged) : ''}
    ${m.nifty50     ? adBar('Nifty 50',           m.nifty50.advancing,     m.nifty50.declining,     m.nifty50.unchanged)     : ''}
  ` : '';

  return card(`
    ${sectionLabel('Market Overview')}
    ${renderSectors(m.topSectors, m.bottomSectors)}
    ${divider()}
    ${sectionLabel('Nifty Total Market — Top Movers')}
    ${renderMovers(m.topGainers, m.topLosers)}
    ${adSection}
  `);
}

// ── Section: Exit Signals ────────────────────────────────────────────────────

function renderExits(exits: ExitCandidate[]): string {
  if (exits.length === 0) {
    return card(`
      ${sectionLabel('Exit Signals')}
      <p style="margin:0;font-size:13px;color:${C.green};">✓ No exit signals today</p>
    `);
  }

  const rows = exits.map((e) => {
    const reasons: string[] = [];
    if (e.byFilter)                        reasons.push('Below 200 DMA / far from ATH');
    if (e.by50Dma && !e.byFilter)          reasons.push('Below 50 DMA');
    if (e.byDrawdown)                      reasons.push('Dropped > 25% since entry');
    else if (e.byDrawdownWarn)             reasons.push('Dropped > 20% since entry');
    if (e.isBE)                            reasons.push('Moved to BE');
    if (e.isUnranked && !e.isBE)           reasons.push('Dropped universe');
    if (e.byRank && e.rank != null && !e.isUnranked) reasons.push(`Rank ${e.rank}`);
    const reason = reasons.join(' · ') || 'Signal triggered';
    const status = e.protected
      ? pill('Protected', '#78350f', C.amber)
      : pill('Exit', '#7f1d1d', C.red);
    return `<tr>
      <td style="padding:8px 0;font-size:13px;font-weight:600;color:${C.text};">${e.symbol}</td>
      <td style="padding:8px 0;font-size:12px;color:${C.muted};text-align:center;">${reason}</td>
      <td style="padding:8px 0;text-align:right;">${status}</td>
    </tr>`;
  }).join('');

  return card(`
    ${sectionLabel(`Exit Signals — ${exits.length} stock${exits.length > 1 ? 's' : ''}`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:left;">Symbol</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:center;">Reason</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:right;">Action</th>
      </tr>
      ${rows}
    </table>
  `);
}

// ── Section: Warning Signals ─────────────────────────────────────────────────

function renderWarnings(warnings: WarnCandidate[]): string {
  if (warnings.length === 0) return '';

  const rows = warnings.map((w) => {
    const reasons: string[] = [];
    if (w.by50Dma) reasons.push('Below 50 DMA');
    if (w.byDrawdownWarn) reasons.push('Dropped > 20% since entry');
    if (w.isBE)    reasons.push('Moved to BE');
    if (w.byRank && w.rank != null) reasons.push(`Rank ${w.rank}`);
    const reason = reasons.join(' · ') || 'Warning triggered';
    const status = w.protected
      ? pill('Protected', '#78350f', C.amber)
      : pill('Watch', '#713f12', C.amber);
    return `<tr>
      <td style="padding:8px 0;font-size:13px;font-weight:600;color:${C.text};">${w.symbol}</td>
      <td style="padding:8px 0;font-size:12px;color:${C.muted};text-align:center;">${reason}</td>
      <td style="padding:8px 0;text-align:right;">${status}</td>
    </tr>`;
  }).join('');

  return card(`
    ${sectionLabel(`Warning Signals — ${warnings.length} stock${warnings.length > 1 ? 's' : ''}`)}
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:left;">Symbol</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:center;">Reason</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:right;">Status</th>
      </tr>
      ${rows}
    </table>
  `, `border-color:#78350f30;`);
}

// ── Section: Entry Candidates ────────────────────────────────────────────────

function renderEntries(entries: EntryCandidate[]): string {
  if (entries.length === 0) {
    return card(`
      ${sectionLabel('Entry Candidates')}
      <p style="margin:0;font-size:13px;color:${C.muted};">No candidates outside portfolio in top 30</p>
    `);
  }

  const rows = entries.map((e) => {
    const newBadge = e.isNewEntrant ? `&nbsp;${pill('NEW', C.purple)}` : '';
    const capColor: Record<string, string> = {
      'Large Cap': C.blue, 'Mid Cap': C.green, 'Small Cap': C.amber,
    };
    const capBg = capColor[e.marketCapCategory ?? ''] ?? C.muted;
    const capBadge = e.marketCapCategory
      ? `<span style="font-size:10px;color:${capBg};">${e.marketCapCategory.replace(' Cap', '')}</span>`
      : '';

    return `<tr>
      <td style="padding:7px 0;font-size:12px;color:${C.muted};width:28px;">${e.rank}</td>
      <td style="padding:7px 0;font-size:13px;font-weight:600;color:${C.text};width:auto;">${e.symbol}${newBadge}</td>
      <td style="padding:7px 0;font-size:12px;color:${C.muted};text-align:right;width:60px;">${(e.athProximityPct - 100).toFixed(1)}%</td>
      <td style="padding:7px 0;text-align:right;width:50px;">${capBadge}</td>
    </tr>`;
  }).join('');

  const newCount = entries.filter((e) => e.isNewEntrant).length;
  const newBanner = newCount > 0
    ? `<p style="margin:-8px 0 14px 0;font-size:12px;color:${C.purple};">${newCount} new entrant${newCount > 1 ? 's' : ''} into top 30</p>`
    : '';

  return card(`
    ${sectionLabel('Entry Candidates')}
    ${newBanner}
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:left;width:28px;">#</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:left;">Symbol</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:right;width:70px;">From ATH</th>
        <th style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;text-align:right;width:50px;">Cap</th>
      </tr>
      ${rows}
    </table>
  `);
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildReportEmail(data: ReportData): { subject: string; html: string } {
  const dateLabel = new Date(data.date + 'T00:00:00Z').toLocaleDateString('en-IN', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const dayPct = data.portfolio?.dayGainPercent;
  const arrow  = dayPct == null ? '' : dayPct >= 0 ? ' ▲' : ' ▼';
  const subject = `Alpha · ${dateLabel}${arrow}${dayPct != null ? ` ${Math.abs(dayPct).toFixed(2)}%` : ''}`;

  const errorBanner = data.errors.length
    ? `<div style="background:#161b22;border:1px solid #5c2c0e;border-radius:8px;padding:10px 16px;margin-bottom:12px;font-size:12px;color:#d97706;">
        ⚠ Partial data: ${data.errors.map((e) => e.split(':')[0]).join(' · ')}
      </div>`
    : '';

  const timeIST = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="${font}background:${C.bg};color:${C.text};margin:0;padding:0;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0 0 2px 0;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">Alpha Portfolio</p>
                    <h1 style="margin:0;font-size:18px;font-weight:600;color:${C.text};">${dateLabel}</h1>
                  </td>
                  ${dayPct != null ? `<td style="text-align:right;vertical-align:middle;">
                    <span style="font-size:22px;font-weight:700;color:${dayPct >= 0 ? C.green : C.red};">${arrow.trim()} ${Math.abs(dayPct).toFixed(2)}%</span>
                  </td>` : ''}
                </tr>
              </table>
            </td>
          </tr>

          ${errorBanner ? `<tr><td>${errorBanner}</td></tr>` : ''}

          <tr><td>${renderAISummary(data.aiSummary)}</td></tr>
          <tr><td>${renderPortfolio(data.portfolio)}</td></tr>
          <tr><td>${renderMarket(data.market)}</td></tr>
          <tr><td>${renderExits(data.exits)}</td></tr>
          <tr><td>${renderWarnings(data.warnings)}</td></tr>
          <tr><td>${renderEntries(data.entries)}</td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:16px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#3d444d;">Generated ${timeIST} IST · Alpha Portfolio Tracker</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
