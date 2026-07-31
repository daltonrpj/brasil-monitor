// ============================================================================
// Public health — InfoDengue (Fiocruz + FGV)
//
// InfoDengue publishes a weekly per-municipality alert level for dengue,
// chikungunya and zika, derived from notified cases, Rt and climate
// receptivity. Keyless, and from a scientific institution rather than a
// scraped page.
//
// The endpoint returns the whole epidemiological year, oldest first, so the
// current reading is the row with the highest SE (year+week) — not the last
// element, which the API does not promise to order.
// ============================================================================

import { getJson } from '../http.js';
import type { DengueAlert } from '../types.js';

/** IBGE municipality codes for the same 12 capitals the climate sensor covers. */
export const CAPITAL_GEOCODES: Array<[city: string, uf: string, geocode: number]> = [
  ['São Paulo', 'SP', 3550308], ['Rio de Janeiro', 'RJ', 3304557], ['Brasília', 'DF', 5300108],
  ['Salvador', 'BA', 2927408], ['Belo Horizonte', 'MG', 3106200], ['Porto Alegre', 'RS', 4314902],
  ['Recife', 'PE', 2611606], ['Manaus', 'AM', 1302603], ['Curitiba', 'PR', 4106902],
  ['Fortaleza', 'CE', 2304400], ['Belém', 'PA', 1501402], ['Goiânia', 'GO', 5208707],
];

/** InfoDengue's four-colour alert scale. */
export const DENGUE_LEVELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Verde', color: '#34d399' },
  2: { label: 'Amarelo', color: '#fbbf24' },
  3: { label: 'Laranja', color: '#fb923c' },
  4: { label: 'Vermelho', color: '#ef4444' },
};

interface RawWeek {
  SE?: number;
  casos?: number;
  casos_est?: number;
  p_inc100k?: number;
  nivel?: number;
  Rt?: number;
  data_iniSE?: number;
}

export function latestWeek(weeks: RawWeek[]): RawWeek | null {
  let best: RawWeek | null = null;
  for (const week of weeks) {
    if (typeof week?.SE !== 'number') continue;
    if (!best || week.SE > (best.SE ?? 0)) best = week;
  }
  return best;
}

export interface HealthOptions {
  /** Injectable for tests — decides which epidemiological year is requested. */
  now?: () => Date;
}

export async function fetchDengueAlerts(options: HealthOptions = {}): Promise<DengueAlert[]> {
  const year = (options.now?.() ?? new Date()).getUTCFullYear();

  const results = await Promise.all(CAPITAL_GEOCODES.map(async ([city, uf, geocode]) => {
    const weeks = await getJson<RawWeek[]>(
      `https://info.dengue.mat.br/api/alertcity?geocode=${geocode}&disease=dengue&format=json` +
      `&ew_start=1&ew_end=53&ey_start=${year}&ey_end=${year}`, 15_000,
    );
    const week = Array.isArray(weeks) ? latestWeek(weeks) : null;
    if (!week) return null;

    const level = Number(week.nivel) || 1;
    return {
      city, uf, geocode,
      level,
      levelLabel: DENGUE_LEVELS[level]?.label ?? 'Verde',
      color: DENGUE_LEVELS[level]?.color ?? '#34d399',
      cases: Math.round(week.casos ?? 0),
      estimatedCases: Math.round(week.casos_est ?? 0),
      incidence100k: week.p_inc100k != null ? Number(week.p_inc100k.toFixed(1)) : null,
      rt: week.Rt != null ? Number(week.Rt.toFixed(2)) : null,
      week: week.SE ?? null,
    } satisfies DengueAlert;
  }));

  return results
    .filter((entry): entry is DengueAlert => entry !== null)
    .sort((a, b) => b.level - a.level || b.estimatedCases - a.estimatedCases);
}
