// ============================================================================
// Live TV — the iptv-org open dataset, restricted to Brazil
//
// iptv-org publishes a community-maintained index of publicly broadcast
// channels as plain JSON. This reads three of those files, joins them, and
// keeps only channels whose country is BR and that actually have a stream.
//
// The three files together are tens of megabytes and they are fetched
// SEQUENTIALLY on purpose: in parallel, the last connection sits in the pool
// queue and reproducibly trips the runtime's connect timeout. With a 12-hour
// cache the extra wall-clock costs nothing.
// ============================================================================

import { getJson } from '../http.js';
import type { TvChannel, TvCatalog, TvStream } from '../types.js';

const API = 'https://iptv-org.github.io/api';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Highest first — the player walks this order as its fallback chain. */
const QUALITY_RANK: Record<string, number> = {
  '2160p': 6, '1440p': 5, '1080p': 4, '720p': 3, '576p': 2, '480p': 1,
};

/** Broad iptv-org categories folded into the groups the dashboard shows. */
const GROUPS: Array<{ group: TvChannel['group']; match: string[] }> = [
  { group: 'Jornalismo', match: ['news', 'business', 'weather'] },
  { group: 'Institucional', match: ['legislative', 'public', 'education'] },
  { group: 'Esportes', match: ['sports'] },
  { group: 'Cultura', match: ['culture', 'documentary', 'travel', 'outdoor', 'music'] },
];

interface RawChannel {
  id?: string; name?: string; country?: string; categories?: string[];
  network?: string | null; owners?: string[]; website?: string | null;
  closed?: string | null; replaced_by?: string | null; is_nsfw?: boolean;
}
interface RawStream {
  channel?: string | null; url?: string; quality?: string | null;
  label?: string | null; feed?: string | null;
}
interface RawLogo {
  channel?: string; url?: string; width?: number; height?: number;
}

function groupOf(categories: string[]): TvChannel['group'] {
  for (const { group, match } of GROUPS) {
    if (categories.some(category => match.includes(category))) return group;
  }
  return 'Geral';
}

function rankStreams(streams: RawStream[]): TvStream[] {
  return streams
    .filter((stream): stream is RawStream & { url: string } => typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url))
    .map(stream => ({
      url: stream.url,
      quality: stream.quality ?? null,
      // "Not 24/7" is iptv-org's marker for a channel that goes off air.
      partTime: /not 24\/7/i.test(stream.label ?? ''),
    }))
    .sort((a, b) => (QUALITY_RANK[b.quality ?? ''] ?? 0) - (QUALITY_RANK[a.quality ?? ''] ?? 0))
    .slice(0, 4); // the player only ever walks four fallbacks
}

let cache: { at: number; catalog: TvCatalog } | null = null;
let inflight: Promise<TvCatalog> | null = null;

export const EMPTY_TV_CATALOG: TvCatalog = { channels: [], groups: [], at: 0, hosts: [] };

async function build(): Promise<TvCatalog> {
  const channels = await getJson<RawChannel[]>(`${API}/channels.json`, 90_000);
  const streams = await getJson<RawStream[]>(`${API}/streams.json`, 90_000);
  const logos = await getJson<RawLogo[]>(`${API}/logos.json`, 90_000);
  if (!Array.isArray(channels) || !Array.isArray(streams)) return EMPTY_TV_CATALOG;

  const streamsByChannel = new Map<string, RawStream[]>();
  for (const stream of streams) {
    if (!stream?.channel) continue;
    const list = streamsByChannel.get(stream.channel);
    if (list) list.push(stream);
    else streamsByChannel.set(stream.channel, [stream]);
  }

  // Prefer the logo the project marks as in use, then the largest one.
  const logoByChannel = new Map<string, { url: string; score: number }>();
  for (const logo of Array.isArray(logos) ? logos : []) {
    if (!logo?.channel || !logo.url) continue;
    const score = (logo.width ?? 0) * (logo.height ?? 0);
    const current = logoByChannel.get(logo.channel);
    if (!current || score > current.score) logoByChannel.set(logo.channel, { url: logo.url, score });
  }

  const out: TvChannel[] = [];
  const hosts = new Set<string>();

  for (const channel of channels) {
    if (!channel?.id || channel.country !== 'BR') continue;
    if (channel.closed || channel.replaced_by) continue;
    if (channel.is_nsfw) continue;

    const ranked = rankStreams(streamsByChannel.get(channel.id) ?? []);
    if (!ranked.length) continue;

    for (const stream of ranked) {
      try { hosts.add(new URL(stream.url).host.toLowerCase()); } catch { /* unparseable URL, already filtered by scheme */ }
    }

    const categories = channel.categories ?? [];
    out.push({
      id: channel.id,
      name: channel.name ?? channel.id,
      group: groupOf(categories),
      categories,
      network: channel.network ?? null,
      website: channel.website ?? null,
      logo: logoByChannel.get(channel.id)?.url ?? null,
      streams: ranked,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const counts = new Map<string, number>();
  for (const channel of out) counts.set(channel.group, (counts.get(channel.group) ?? 0) + 1);

  return {
    channels: out,
    groups: [...counts.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count),
    at: Date.now(),
    hosts: [...hosts].sort(),
  };
}

export interface TvOptions {
  /** Skip the 12-hour cache. */
  force?: boolean;
}

export async function fetchBrazilianChannels(options: TvOptions = {}): Promise<TvCatalog> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.catalog;
  // Several dashboard tabs can ask for this at once on a cold start; one build.
  if (inflight) return inflight;

  inflight = build()
    .then(catalog => {
      if (catalog.channels.length) cache = { at: Date.now(), catalog };
      return catalog;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

/** Test seam — the cache is module-level, so suites have to be able to clear it. */
export function resetTvCache(): void {
  cache = null;
  inflight = null;
}
