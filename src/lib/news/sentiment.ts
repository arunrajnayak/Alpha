/**
 * Lightweight, deterministic headline sentiment for the Radar news panel.
 *
 * This is a keyword-lexicon scorer — NOT investment advice. It gives a quick
 * "market mood" read from recent headlines (bullish / neutral / bearish).
 */

export type Sentiment = 'bullish' | 'bearish' | 'neutral';

// Word stems matched as whole words (case-insensitive). Kept intentionally
// finance-flavoured to reduce false positives from generic language.
const BULLISH = [
  'surge', 'surges', 'surged', 'jump', 'jumps', 'jumped', 'soar', 'soars', 'soared',
  'rally', 'rallies', 'rallied', 'gain', 'gains', 'gained', 'rise', 'rises', 'rose',
  'climb', 'climbs', 'up', 'upside', 'record', 'high', 'profit', 'profits', 'beat',
  'beats', 'upgrade', 'upgraded', 'buy', 'bullish', 'outperform', 'outperforms',
  'win', 'wins', 'won', 'order', 'orders', 'deal', 'deals', 'expansion', 'expand',
  'growth', 'strong', 'positive', 'approval', 'approved', 'dividend', 'bonus',
  'acquire', 'acquires', 'acquisition', 'multibagger', 'breakout', 'stake buy',
  'target raised', 'hikes', 'boost', 'boosts', 'rerating', 're-rating', 'demand',
];

const BEARISH = [
  'fall', 'falls', 'fell', 'drop', 'drops', 'dropped', 'plunge', 'plunges', 'plunged',
  'slump', 'slumps', 'decline', 'declines', 'declined', 'loss', 'losses', 'miss',
  'misses', 'downgrade', 'downgraded', 'sell', 'bearish', 'underperform', 'probe',
  'fraud', 'scam', 'raid', 'ban', 'banned', 'penalty', 'fine', 'fined', 'crash',
  'crashes', 'weak', 'negative', 'cut', 'cuts', 'layoff', 'layoffs', 'resign',
  'resigns', 'default', 'debt', 'warning', 'warns', 'tumble', 'tumbles', 'slide',
  'slides', 'downside', 'block deal', 'stake sale', 'pledge', 'pledged', 'lawsuit',
  'downtrend', 'halt', 'halts', 'recall', 'insolvency', 'downbeat', 'concern', 'concerns',
];

function buildMatcher(words: string[]): RegExp {
  // Escape and join as whole-word alternation; multi-word phrases allowed.
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|\\W)(?:${escaped.join('|')})(?=\\W|$)`, 'gi');
}

const BULL_RE = buildMatcher(BULLISH);
const BEAR_RE = buildMatcher(BEARISH);

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

/** Sentiment for a single headline. */
export function scoreHeadline(title: string): { sentiment: Sentiment; score: number } {
  const t = ` ${title.toLowerCase()} `;
  const bull = countMatches(t, BULL_RE);
  const bear = countMatches(t, BEAR_RE);
  const score = bull - bear;
  const sentiment: Sentiment = score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral';
  return { sentiment, score };
}

export interface MoodResult {
  mood: Sentiment;
  /** Net score normalised to roughly -100..100 for a gauge. */
  score: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
}

/** Aggregate mood across a set of headlines. */
export function aggregateMood(titles: string[]): MoodResult {
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let net = 0;

  for (const title of titles) {
    const { sentiment, score } = scoreHeadline(title);
    net += score;
    if (sentiment === 'bullish') bullishCount++;
    else if (sentiment === 'bearish') bearishCount++;
    else neutralCount++;
  }

  const total = titles.length || 1;
  // Normalise by headline count so a handful of strong words doesn't peg the gauge.
  const normalized = Math.max(-100, Math.min(100, Math.round((net / total) * 60)));
  const mood: Sentiment = normalized > 8 ? 'bullish' : normalized < -8 ? 'bearish' : 'neutral';

  return { mood, score: normalized, bullishCount, bearishCount, neutralCount };
}
