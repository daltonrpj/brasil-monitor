// ============================================================================
// Banco Central — SGS time series and Focus market expectations
//
// SGS (Sistema Gerenciador de Séries Temporais) is the Central Bank's public
// series database — Selic, IPCA, PTAX dollar, and dozens more, each behind a
// numeric code. `/dados/ultimos/N` caps N at 20 (returns HTTP 400 above that),
// which is why the sparkline history below is short by design, not by choice.
// ============================================================================

import { getJson } from '../http.js';
import type { BcbHistory, BcbIndicators, FocusExpectations, Indicator } from '../types.js';

const SERIES = {
  selic: 432, cdi: 4389, ipcaMes: 433, ipca12m: 13522, igpm: 189,
  dolarPtax: 1, unemployment: 24369, debtToGdp: 13762, reserves: 3546, ibcbr: 24363,
};

const MAX_SGS_POINTS = 20;

interface SgsPoint { data: string; valor: string }

async function sgsLatest(code: number): Promise<{ value: number; date: string } | null> {
  const data = await getJson<SgsPoint[]>(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`, 8_000,
  );
  const point = Array.isArray(data) ? data[0] : null;
  return point ? { value: parseFloat(point.valor), date: point.data } : null;
}

async function sgsHistory(code: number, count = MAX_SGS_POINTS): Promise<number[]> {
  const data = await getJson<SgsPoint[]>(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${Math.min(MAX_SGS_POINTS, count)}?formato=json`,
    10_000,
  );
  if (!Array.isArray(data)) return [];
  return data.map(point => parseFloat(point.valor)).filter(Number.isFinite);
}

function toIndicator(point: { value: number; date: string } | null, label: string, unit: string): Indicator | null {
  return point ? { label, value: point.value, unit, date: point.date } : null;
}

export async function fetchIndicators(): Promise<BcbIndicators> {
  const [selic, cdi, ipca12m, ipcaMes, igpm, dolar, unemployment, debtToGdp, reserves, ibcbr] = await Promise.all([
    sgsLatest(SERIES.selic), sgsLatest(SERIES.cdi), sgsLatest(SERIES.ipca12m), sgsLatest(SERIES.ipcaMes),
    sgsLatest(SERIES.igpm), sgsLatest(SERIES.dolarPtax), sgsLatest(SERIES.unemployment),
    sgsLatest(SERIES.debtToGdp), sgsLatest(SERIES.reserves), sgsLatest(SERIES.ibcbr),
  ]);

  const indicators: BcbIndicators = {
    selic: toIndicator(selic, 'Selic (meta)', '% a.a.'),
    cdi: toIndicator(cdi, 'CDI', '% a.a.'),
    ipca12m: toIndicator(ipca12m, 'IPCA (12m)', '%'),
    ipcaMes: toIndicator(ipcaMes, 'IPCA (mês)', '%'),
    igpm: toIndicator(igpm, 'IGP-M (mês)', '%'),
    dolar: toIndicator(dolar, 'Dólar (PTAX)', 'R$'),
    unemployment: toIndicator(unemployment, 'Desemprego', '%'),
    debtToGdp: toIndicator(debtToGdp, 'Dívida/PIB', '%'),
    reserves: reserves ? { label: 'Reservas intl.', value: +(reserves.value / 1000).toFixed(0), unit: 'US$ bi', date: reserves.date } : null,
    ibcbr: toIndicator(ibcbr, 'IBC-Br (índice)', ''),
    realRate: null,
  };

  // Ex-post real rate — the one number the risk engine and cross-signals lean on most.
  if (indicators.selic && indicators.ipca12m) {
    const real = ((1 + indicators.selic.value / 100) / (1 + indicators.ipca12m.value / 100) - 1) * 100;
    indicators.realRate = { label: 'Juro real', value: +real.toFixed(2), unit: '% a.a.', date: indicators.selic.date };
  }

  return indicators;
}

export async function fetchHistory(): Promise<BcbHistory> {
  const [selic, ipca, dolar, cdi] = await Promise.all([
    sgsHistory(SERIES.selic, 20), sgsHistory(SERIES.ipcaMes, 18), sgsHistory(SERIES.dolarPtax, 20), sgsHistory(SERIES.cdi, 20),
  ]);
  return { selic, ipca, dolar, cdi };
}

/**
 * Focus — the median of market analysts' own forecasts, published weekly via
 * the Central Bank's Olinda OData service. Cached for 6h since Focus updates
 * once a week.
 */
let focusCache: { at: number; data: FocusExpectations | null } = { at: 0, data: null };

export async function fetchFocusExpectations(): Promise<FocusExpectations | null> {
  if (focusCache.data && Date.now() - focusCache.at < 6 * 60 * 60 * 1000) return focusCache.data;

  const year = new Date().getUTCFullYear();
  const filter = encodeURIComponent(
    `DataReferencia eq '${year}' and (Indicador eq 'IPCA' or Indicador eq 'Selic' or Indicador eq 'PIB Total' or Indicador eq 'Câmbio')`,
  );
  const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais` +
    `?$top=80&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana&$filter=${filter}`;

  const data = await getJson<{ value?: Array<{ Indicador: string; Data: string; DataReferencia: string; Mediana: number }> }>(url, 12_000);
  const byIndicator: Record<string, { median: number; date: string }> = {};
  for (const row of data?.value ?? []) {
    if (!byIndicator[row.Indicador]) byIndicator[row.Indicador] = { median: row.Mediana, date: row.Data };
  }

  const result: FocusExpectations = {
    year,
    ipca: byIndicator['IPCA']?.median ?? null,
    selic: byIndicator['Selic']?.median ?? null,
    gdp: byIndicator['PIB Total']?.median ?? null,
    fx: byIndicator['Câmbio']?.median ?? null,
    date: byIndicator['IPCA']?.date ?? null,
  };
  focusCache = { at: Date.now(), data: result };
  return result;
}
