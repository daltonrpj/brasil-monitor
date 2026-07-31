// ============================================================================
// Official news — Agência Brasil (EBC), Agência Câmara, Agência Senado
//
// All three publish plain RSS 2.0, keyless. This matters beyond the headline
// list: the risk index has always had a "crisis flow in the headlines"
// component, and until now the caller had to supply the headlines. With these
// three feeds the component fills itself from state-owned press agencies
// rather than from whatever aggregator happened to be at hand.
//
// The parser below is deliberately small — 40 lines of regex over well-formed
// government RSS, instead of a dependency. It handles CDATA (Câmara uses it,
// EBC does not) and the five XML entities; anything more exotic than that is
// left as-is rather than half-decoded.
// ============================================================================

import { getText } from '../http.js';
import type { NewsItem, NewsSource } from '../types.js';

const FEEDS: Array<{ source: NewsSource; label: string; url: string }> = [
  { source: 'Agência Brasil', label: 'EBC', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { source: 'Câmara', label: 'Agência Câmara', url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias' },
  { source: 'Senado', label: 'Agência Senado', url: 'https://www12.senado.leg.br/noticias/rss' },
];

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

export function decodeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, match => ENTITIES[match] ?? match);
}

/** Read one tag out of an RSS <item>, unwrapping CDATA and stripping markup. */
export function tagText(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  let value = match[1] ?? '';
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) value = cdata[1] ?? '';
  // Feeds escape their HTML, so entities have to be decoded before the tag
  // strip — otherwise "&lt;p&gt;" survives as literal text in the summary.
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseRss(xml: string, limit = 12): Array<{ title: string; link: string; date: string | null; summary: string }> {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, limit).map(item => {
    const pubDate = tagText(item, 'pubDate');
    const parsed = pubDate ? new Date(pubDate) : null;
    return {
      title: tagText(item, 'title'),
      link: tagText(item, 'link'),
      date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      summary: tagText(item, 'description').slice(0, 220),
    };
  }).filter(item => item.title);
}

export async function fetchOfficialNews(perFeed = 10): Promise<NewsItem[]> {
  const results = await Promise.all(FEEDS.map(async feed => {
    const xml = await getText(feed.url, 14_000);
    if (!xml) return [];
    return parseRss(xml, perFeed).map(item => ({ ...item, source: feed.source, agency: feed.label }));
  }));

  // Newest first across all three agencies; undated items sink to the bottom
  // rather than being dropped — a headline without a pubDate is still a headline.
  return results.flat().sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}
