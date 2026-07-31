// ============================================================================
// Regional economy — IBGE SIDRA
//
// Three tables, all keyless:
//   5938 v/37   GDP at current prices, per state (thousands of BRL)
//   6579 v/9324 resident population estimate, per state
//   6381 v/4099 unemployment rate, national, rolling quarter
//
// GDP and population are published for different reference years (GDP lags by
// about two years), so per-capita here is "latest GDP over latest population"
// — an indicator, not a national-accounts figure. The year of each is carried
// through to the caller so the UI can say so.
// ============================================================================

import { foldAccents, REGION_ORDER, STATE_NAME_TO_UF, STATE_REGION } from '../geo.js';
import type { Region, StateGdp, RegionEconomy, UF, Indicator } from '../types.js';
import { sidra, sidraValue, type SidraRow } from './sidra.js';

function ufOf(row: SidraRow): UF | null {
  return STATE_NAME_TO_UF[foldAccents(row.D1N ?? '')] ?? null;
}

/** GDP per state, plus the same data folded into IBGE's five regions. */
export async function fetchRegionalEconomy(): Promise<{
  states: StateGdp[];
  regions: RegionEconomy[];
  gdpYear: string | null;
  populationYear: string | null;
  totalGdp: number;
}> {
  const [gdpRows, popRows] = await Promise.all([
    sidra('t/5938/n3/all/v/37/p/last%201'),
    sidra('t/6579/n3/all/v/9324/p/last%201'),
  ]);

  const population = new Map<UF, number>();
  let populationYear: string | null = null;
  for (const row of popRows) {
    const uf = ufOf(row);
    const value = sidraValue(row);
    if (uf && value != null) {
      population.set(uf, value);
      populationYear ??= row.D3N ?? null;
    }
  }

  let gdpYear: string | null = null;
  const states: StateGdp[] = [];
  for (const row of gdpRows) {
    const uf = ufOf(row);
    const thousands = sidraValue(row);
    if (!uf || thousands == null) continue;
    gdpYear ??= row.D3N ?? null;

    const gdp = thousands * 1000; // SIDRA publishes this table in thousands of BRL
    const pop = population.get(uf) ?? null;
    states.push({
      uf,
      name: row.D1N ?? uf,
      region: STATE_REGION[uf] ?? 'Sudeste',
      gdp,
      population: pop,
      gdpPerCapita: pop ? gdp / pop : null,
    });
  }

  const totalGdp = states.reduce((sum, s) => sum + s.gdp, 0);
  const regions: RegionEconomy[] = REGION_ORDER.map(region => {
    const members = states.filter(s => s.region === region);
    const gdp = members.reduce((sum, s) => sum + s.gdp, 0);
    const pop = members.reduce((sum, s) => sum + (s.population ?? 0), 0);
    return {
      region: region as Region,
      gdp,
      share: totalGdp ? (gdp / totalGdp) * 100 : 0,
      population: pop || null,
      gdpPerCapita: pop ? gdp / pop : null,
      states: members.length,
    };
  }).filter(r => r.states > 0);

  states.sort((a, b) => b.gdp - a.gdp);
  return { states, regions, gdpYear, populationYear, totalGdp };
}

/** National unemployment rate — PNAD Contínua's rolling quarter. */
export async function fetchUnemployment(): Promise<Indicator | null> {
  const rows = await sidra('t/6381/n1/all/v/4099/p/last%201', 15_000);
  const row = rows[0];
  const value = row ? sidraValue(row) : null;
  if (value == null) return null;
  return { label: 'Taxa de desocupação', value, unit: '%', date: row?.D3N ?? '' };
}
