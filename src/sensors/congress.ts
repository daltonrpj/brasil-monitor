// ============================================================================
// Câmara dos Deputados — open data on bills, votes and the legislative agenda
// ============================================================================

import { getJson } from '../http.js';
import type { AgendaItem, CongressProposal, CongressRadar, CongressVote } from '../types.js';

interface RawProposal { id: number; siglaTipo: string; numero: string; ano: string; ementa?: string }
interface RawVote {
  id: number; dataHoraRegistro?: string; data?: string;
  descricao?: string; proposicaoObjeto?: string; siglaOrgao?: string; aprovacao?: number;
}
interface RawEvent {
  id: number; dataHoraInicio?: string;
  descricao?: string; descricaoTipo?: string; localCamara?: { nome?: string }; situacao?: string;
}

export async function fetchCongressRadar(): Promise<CongressRadar> {
  const [proposalsResponse, votesResponse] = await Promise.all([
    getJson<{ dados?: RawProposal[] }>(
      'https://dadosabertos.camara.leg.br/api/v2/proposicoes?ordem=DESC&ordenarPor=id&itens=12', 14_000,
    ),
    getJson<{ dados?: RawVote[] }>(
      'https://dadosabertos.camara.leg.br/api/v2/votacoes?ordem=DESC&ordenarPor=dataHoraRegistro&itens=10', 14_000,
    ),
  ]);

  const proposals: CongressProposal[] = (proposalsResponse?.dados ?? []).map(p => ({
    id: p.id,
    code: `${p.siglaTipo} ${p.numero}/${p.ano}`,
    summary: (p.ementa ?? '').slice(0, 240),
    url: `https://www.camara.leg.br/propostas-legislativas/${p.id}`,
  }));

  const votes: CongressVote[] = (votesResponse?.dados ?? []).map(v => ({
    id: v.id,
    date: v.dataHoraRegistro || v.data || null,
    description: (v.descricao || v.proposicaoObjeto || '').slice(0, 200),
    body: v.siglaOrgao ?? '',
    approved: v.aprovacao === 1 ? true : v.aprovacao === 0 ? false : null,
    url: 'https://www.camara.leg.br',
  }));

  return { proposals, votes };
}

export async function fetchAgenda(): Promise<AgendaItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const in48h = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://dadosabertos.camara.leg.br/api/v2/eventos?dataInicio=${today}&dataFim=${in48h}` +
    `&ordem=ASC&ordenarPor=dataHoraInicio&itens=12`;

  const data = await getJson<{ dados?: RawEvent[] }>(url, 14_000);
  return (data?.dados ?? []).map(event => ({
    id: event.id,
    start: event.dataHoraInicio ?? null,
    description: (event.descricao || event.descricaoTipo || '').slice(0, 160),
    type: event.descricaoTipo ?? '',
    place: event.localCamara?.nome ?? '',
    status: event.situacao ?? '',
    url: `https://www.camara.leg.br/evento-legislativo/${event.id}`,
  }));
}
