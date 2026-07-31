// ============================================================================
// IBGE — official statistics agency: news feed and the population "clock"
// ============================================================================

import { getJson } from '../http.js';

export interface IbgeNewsItem {
  title: string;
  intro: string;
  date: string | null;
  link: string;
  type: string;
}

export async function fetchIbgeNews(): Promise<IbgeNewsItem[]> {
  const data = await getJson<{ items?: Array<Record<string, string>> }>(
    'https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=10', 12_000,
  );
  return (data?.items ?? []).map(item => ({
    title: item.titulo ?? '',
    intro: (item.introducao ?? '').slice(0, 200),
    date: item.data_publicacao ?? null,
    link: item.link ?? '',
    type: item.tipo || 'Notícia',
  }));
}

export interface Population {
  total: number;
  horizon: string | null;
}

export async function fetchPopulation(): Promise<Population | null> {
  const data = await getJson<{ projecao?: { populacao?: number }; horizonte?: string }>(
    'https://servicodados.ibge.gov.br/api/v1/projecoes/populacao', 10_000,
  );
  return data?.projecao?.populacao
    ? { total: data.projecao.populacao, horizon: data.horizonte ?? null }
    : null;
}
