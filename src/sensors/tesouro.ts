// ============================================================================
// Tesouro Direto — official bond rates
//
// The old treasurybondsinfo.json endpoint was discontinued (HTTP 410). The
// current official source is Tesouro Transparente's public CKAN dataset: a
// ~14MB CSV of the full rate history, updated once per business day. Cached
// for 6 hours in-process — there is no reason to re-download a 14MB file that
// changes once a day on every request.
// ============================================================================

import { getText } from '../http.js';
import type { TesouroTitle } from '../types.js';

const CSV_URL =
  'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/' +
  'resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 40_000; // ~14MB, once a day — the 6h cache absorbs the cost
const MAX_TITLES = 16;

function parseBrazilianDate(value: string): number {
  const [day, month, year] = String(value).split('/').map(Number);
  return day && month && year ? new Date(year, month - 1, day).getTime() : 0;
}

function parseBrazilianNumber(value: string | undefined): number | null {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

interface CsvRow {
  type: string;
  maturity: string;
  baseAt: number;
  buyRate: string;
  sellRate: string;
  buyPrice: string;
}

function parseCsv(text: string): CsvRow[] {
  const byKey = new Map<string, CsvRow>();
  const lines = text.split('\n');

  // Row 0 is the header; each subsequent row is one title on one trading day.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const [type, maturity, base, buyRate, sellRate, buyPrice] = line.split(';');
    if (!type || !maturity || !base) continue;

    const key = `${type}|${maturity}`;
    const baseAt = parseBrazilianDate(base);
    const existing = byKey.get(key);
    // Only the most recent trading day's quote per title survives.
    if (!existing || baseAt > existing.baseAt) {
      byKey.set(key, { type, maturity, baseAt, buyRate: buyRate ?? '', sellRate: sellRate ?? '', buyPrice: buyPrice ?? '' });
    }
  }

  return [...byKey.values()];
}

let cache: { at: number; data: TesouroTitle[] } = { at: 0, data: [] };

export async function fetchTesouroDireto(): Promise<TesouroTitle[]> {
  if (cache.data.length && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const text = await getText(CSV_URL, FETCH_TIMEOUT_MS);
  if (!text) return cache.data; // stale cache beats nothing

  const now = Date.now();
  const rows = parseCsv(text)
    .filter(row => parseBrazilianDate(row.maturity) > now) // only titles still tradeable
    .map((row): TesouroTitle => ({
      name: row.type,
      maturity: row.maturity.split('/').reverse().join('-'),
      buyRate: parseBrazilianNumber(row.buyRate),
      sellRate: parseBrazilianNumber(row.sellRate),
      buyPrice: parseBrazilianNumber(row.buyPrice),
    }))
    .filter(title => title.buyRate != null || title.sellRate != null)
    .sort((a, b) => a.maturity.localeCompare(b.maturity))
    .slice(0, MAX_TITLES);

  cache = { at: Date.now(), data: rows };
  return rows;
}

/** For tests: parse CSV text directly, bypassing the network and the cache. */
export function parseTesouroCsv(text: string): TesouroTitle[] {
  const now = Date.now();
  return parseCsv(text)
    .filter(row => parseBrazilianDate(row.maturity) > now)
    .map((row): TesouroTitle => ({
      name: row.type,
      maturity: row.maturity.split('/').reverse().join('-'),
      buyRate: parseBrazilianNumber(row.buyRate),
      sellRate: parseBrazilianNumber(row.sellRate),
      buyPrice: parseBrazilianNumber(row.buyPrice),
    }))
    .filter(title => title.buyRate != null || title.sellRate != null)
    .sort((a, b) => a.maturity.localeCompare(b.maturity))
    .slice(0, MAX_TITLES);
}
