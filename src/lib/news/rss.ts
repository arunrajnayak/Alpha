/**
 * Minimal, dependency-free RSS/Atom item parser.
 *
 * SECURITY: uses targeted regexes over feed text — no XML/DTD parser is invoked,
 * so there is no XXE / entity-expansion surface.
 */

export interface RawNewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO
}

export const NEWS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/** Extract an href from an Atom <link .../> self-closing tag. */
function pickAtomLink(block: string): string {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decodeEntities(alt[1]);
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? decodeEntities(any[1]) : '';
}

/**
 * Parse both RSS (<item>) and Atom (<entry>) feeds into news items.
 * `defaultSource` labels items when the feed doesn't name an outlet.
 */
export function parseRssItems(xml: string, defaultSource = 'News', limit = 40): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const block of blocks) {
    const title = pick(block, 'title');
    const link = isAtom ? pickAtomLink(block) : pick(block, 'link');
    if (!title || !link) continue;

    const sourceName = pick(block, 'source') || defaultSource;
    const pub = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated');
    const publishedAt =
      pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : new Date().toISOString();

    let cleanTitle = title;
    if (sourceName && cleanTitle.endsWith(` - ${sourceName}`)) {
      cleanTitle = cleanTitle.slice(0, -(sourceName.length + 3)).trim();
    }

    items.push({ title: cleanTitle, url: link, source: sourceName, publishedAt });
    if (items.length >= limit) break;
  }

  return items;
}
