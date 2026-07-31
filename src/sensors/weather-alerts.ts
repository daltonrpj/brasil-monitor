// ============================================================================
// INMET — active severe weather alerts
//
// Brazil's national meteorological institute publishes active alerts at a
// public, keyless endpoint. Severity comes in three tiers translated here as
// amarelo (potential danger) / laranja (danger) / vermelho (great danger) —
// kept in Portuguese because that is what INMET's own bulletins call them,
// and what anyone cross-referencing against the official alert page expects.
// ============================================================================

import { getJson } from '../http.js';
import { foldAccents, REGION_ORDER, STATE_CENTROID, STATE_NAME_TO_UF, STATE_REGION } from '../geo.js';
import type { RegionalBreakdown, Severity, WeatherAlert } from '../types.js';

const SEVERITY_MAP: Record<string, Severity> = {
  'perigo potencial': 'amarelo',
  perigo: 'laranja',
  'grande perigo': 'vermelho',
};

const SEVERITY_RANK: Record<Severity, number> = { vermelho: 3, laranja: 2, amarelo: 1 };

function classifySeverity(raw: string): Severity {
  const folded = foldAccents(raw);
  if (SEVERITY_MAP[folded]) return SEVERITY_MAP[folded];
  if (folded.includes('grande')) return 'vermelho';
  if (folded.includes('potencial')) return 'amarelo';
  if (folded.includes('perigo')) return 'laranja';
  return 'amarelo';
}

function extractUFs(rawStates: string, municipalities: string): string[] {
  const fromStates = String(rawStates ?? '')
    .split(',')
    .map(s => s.trim())
    .map(s => (STATE_CENTROID[s.toUpperCase()] ? s.toUpperCase() : STATE_NAME_TO_UF[foldAccents(s)]))
    .filter((uf): uf is string => Boolean(uf));

  if (fromStates.length) return [...new Set(fromStates)].slice(0, 27);

  // Fallback: pull UF codes out of municipality text like "Porto Alegre - RS, ...".
  const found = new Set<string>();
  for (const match of String(municipalities ?? '').matchAll(/-\s*([A-Z]{2})\b/g)) {
    if (STATE_CENTROID[match[1]!]) found.add(match[1]!);
  }
  return [...found].slice(0, 27);
}

interface RawInmetAlert {
  descricao?: string; evento?: string;
  severidade?: string; aviso_cor?: string;
  estados?: string; uf?: string; municipios?: string;
  riscos?: unknown;
  data_inicio?: string; inicio?: string;
  data_fim?: string; fim?: string;
  id_aviso?: string;
}

export async function fetchActiveAlerts(): Promise<WeatherAlert[]> {
  const data = await getJson<unknown>('https://apiprevmet3.inmet.gov.br/avisos/ativos', 14_000);
  const list: RawInmetAlert[] = Array.isArray(data)
    ? data as RawInmetAlert[]
    : data && typeof data === 'object'
      ? [
          ...((data as Record<string, RawInmetAlert[]>).hoje ?? []),
          ...((data as Record<string, RawInmetAlert[]>).futuro ?? []),
          ...((data as Record<string, RawInmetAlert[]>).avisos ?? []),
        ]
      : [];

  if (!list.length) return [];

  return list.slice(0, 40).map(alert => ({
    event: alert.descricao || alert.evento || 'Aviso meteorológico',
    severity: classifySeverity(alert.severidade || alert.aviso_cor || ''),
    ufs: extractUFs(alert.estados || alert.uf || '', alert.municipios || ''),
    risks: alert.riscos ? String(alert.riscos).slice(0, 220) : '',
    start: alert.data_inicio || alert.inicio || null,
    end: alert.data_fim || alert.fim || null,
    url: alert.id_aviso ? `https://alertas2.inmet.gov.br/${alert.id_aviso}` : 'https://alertas2.inmet.gov.br',
  }));
}

/** Aggregate alerts by IBGE region, weighted by how many states each alert covers. */
export function regionalBreakdown(alerts: WeatherAlert[]): RegionalBreakdown[] {
  const byRegion = new Map<string, RegionalBreakdown>();

  for (const alert of alerts) {
    for (const uf of alert.ufs) {
      const region = STATE_REGION[uf];
      if (!region) continue;

      const current = byRegion.get(region) ?? { region, count: 0, worst: 'amarelo' as Severity };
      current.count++;
      if (SEVERITY_RANK[alert.severity] > SEVERITY_RANK[current.worst ?? 'amarelo']) {
        current.worst = alert.severity;
      }
      byRegion.set(region, current);
    }
  }

  return REGION_ORDER.map(region => byRegion.get(region) ?? { region, count: 0, worst: null });
}
