// ============================================================================
// Senado Federal — dados abertos
//
// The mirror of the existing Câmara sensor, for the other chamber. Two calls:
// bills touched in the last few days, and floor votes over a date window (the
// service caps that window at 60 days).
//
// The votes endpoint embeds every senator's individual vote in the response,
// which is most of its payload and none of its signal at this level — the
// tally is kept, the roll call is dropped.
// ============================================================================

import { getJson } from '../http.js';
import type { SenateBill, SenateRadar, SenateVote } from '../types.js';

const BASE = 'https://legis.senado.leg.br/dadosabertos';

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Senado's XML-derived JSON keeps the source document's hard line wrapping. */
function clean(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

interface RawMateria {
  IdentificacaoMateria?: Record<string, string>;
  DadosBasicosMateria?: Record<string, string>;
}

async function fetchBills(days: number, limit: number): Promise<SenateBill[]> {
  const data = await getJson<{ ListaMateriasAtualizadas?: { Materias?: { Materia?: RawMateria | RawMateria[] } } }>(
    `${BASE}/materia/atualizadas?numdias=${days}&v=5`, 18_000,
  );

  const bills: SenateBill[] = [];
  for (const item of asArray(data?.ListaMateriasAtualizadas?.Materias?.Materia)) {
    const id = item.IdentificacaoMateria ?? {};
    if (id.IndicadorTramitando !== 'Sim') continue; // the feed is dominated by decades-old archived bills
    const code = clean(id.DescricaoIdentificacaoMateria);
    if (!code) continue;
    bills.push({
      code,
      year: Number(id.AnoMateria) || 0,
      kind: clean(id.DescricaoSubtipoMateria) || 'Matéria',
      house: clean(id.NomeCasaIdentificacaoMateria) || 'Senado Federal',
      summary: clean(item.DadosBasicosMateria?.EmentaMateria).slice(0, 260),
      url: id.CodigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${id.CodigoMateria}` : '',
    });
  }

  // "Updated in the last N days" includes 1990s broadcasting decrees that get a
  // procedural touch and nothing else. Newest first surfaces what is actually
  // moving through the house now.
  return bills.sort((a, b) => b.year - a.year).slice(0, limit);
}

interface RawVotacao {
  DataSessao?: string;
  DescricaoVotacao?: string;
  Resultado?: string;
  DescricaoIdentificacaoMateria?: string;
  CodigoMateria?: string;
  Secreta?: string;
}

const RESULT: Record<string, boolean | null> = { A: true, R: false };

async function fetchVotes(now: Date, windowDays: number, limit: number): Promise<SenateVote[]> {
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const data = await getJson<{ ListaVotacoes?: { Votacoes?: { Votacao?: RawVotacao | RawVotacao[] } } }>(
    `${BASE}/plenario/lista/votacao/${ymd(from)}/${ymd(now)}`, 20_000,
  );

  return asArray(data?.ListaVotacoes?.Votacoes?.Votacao)
    .map(vote => ({
      date: vote.DataSessao ?? null,
      subject: clean(vote.DescricaoIdentificacaoMateria) || clean(vote.DescricaoVotacao).slice(0, 90),
      description: clean(vote.DescricaoVotacao).slice(0, 220),
      approved: RESULT[vote.Resultado ?? ''] ?? null,
      secret: vote.Secreta === 'S',
      url: vote.CodigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${vote.CodigoMateria}` : '',
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit);
}

export interface SenateOptions {
  /** Injectable for tests — the vote window is computed relative to this. */
  now?: () => Date;
}

export async function fetchSenateRadar(options: SenateOptions = {}): Promise<SenateRadar> {
  const now = options.now?.() ?? new Date();
  const [bills, votes] = await Promise.all([fetchBills(5, 12), fetchVotes(now, 45, 10)]);
  return { bills, votes };
}
