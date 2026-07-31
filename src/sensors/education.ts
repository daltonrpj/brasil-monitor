// ============================================================================
// Education — IBGE PNAD Contínua, via SIDRA
//
//   7126 v/3593  mean years of schooling, 15+ years old
//   7113 v/10267 illiteracy rate, 15+ years old
//
// Both tables are cut by sex and age group, and SIDRA returns nothing but ".."
// unless you pin those classifications explicitly — c2/6794 is "Sexo: Total"
// and c58/2795 is "15 anos ou mais". Without them every row reads as missing,
// which looks exactly like a dead endpoint.
// ============================================================================

import { foldAccents, REGION_ORDER, STATE_NAME_TO_UF, STATE_REGION } from '../geo.js';
import type { EducationSnapshot, StateEducation, UF } from '../types.js';
import { sidra, sidraValue, type SidraRow } from './sidra.js';

const TOTAL_CUTS = 'c2/6794/c58/2795';

function ufOf(row: SidraRow): UF | null {
  return STATE_NAME_TO_UF[foldAccents(row.D1N ?? '')] ?? null;
}

function collect(rows: SidraRow[]): { byUf: Map<UF, number>; year: string | null } {
  const byUf = new Map<UF, number>();
  let year: string | null = null;
  for (const row of rows) {
    const uf = ufOf(row);
    const value = sidraValue(row);
    if (uf && value != null) {
      byUf.set(uf, value);
      year ??= row.D3N ?? null;
    }
  }
  return { byUf, year };
}

export async function fetchEducation(): Promise<EducationSnapshot> {
  const [schoolingRows, illiteracyRows] = await Promise.all([
    sidra(`t/7126/n3/all/v/3593/p/last%201/${TOTAL_CUTS}`),
    sidra(`t/7113/n3/all/v/10267/p/last%201/${TOTAL_CUTS}`),
  ]);

  const schooling = collect(schoolingRows);
  const illiteracy = collect(illiteracyRows);

  const states: StateEducation[] = [...schooling.byUf.keys()]
    .map(uf => ({
      uf,
      region: STATE_REGION[uf] ?? 'Sudeste',
      yearsOfStudy: schooling.byUf.get(uf) ?? null,
      illiteracyRate: illiteracy.byUf.get(uf) ?? null,
    }))
    .sort((a, b) => (b.yearsOfStudy ?? 0) - (a.yearsOfStudy ?? 0));

  // Unweighted mean across the states of each region: this is a comparison of
  // state-level outcomes, not a population-weighted regional figure — SP would
  // otherwise swallow the entire Sudeste reading.
  const regions = REGION_ORDER.map(region => {
    const members = states.filter(s => s.region === region);
    const years = members.map(s => s.yearsOfStudy).filter((v): v is number => v != null);
    const illit = members.map(s => s.illiteracyRate).filter((v): v is number => v != null);
    return {
      region,
      yearsOfStudy: years.length ? years.reduce((a, b) => a + b, 0) / years.length : null,
      illiteracyRate: illit.length ? illit.reduce((a, b) => a + b, 0) / illit.length : null,
      states: members.length,
    };
  }).filter(r => r.states > 0);

  const allYears = states.map(s => s.yearsOfStudy).filter((v): v is number => v != null);

  return {
    states,
    regions,
    year: schooling.year,
    national: allYears.length ? allYears.reduce((a, b) => a + b, 0) / allYears.length : null,
    best: states[0] ?? null,
    worst: states.at(-1) ?? null,
  };
}
