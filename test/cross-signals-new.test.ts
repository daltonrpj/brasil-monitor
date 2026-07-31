import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crossSignals } from '../src/cross-signals.js';
import type { BcbIndicators, CongressRadar, Indicator, NewsItem, SenateRadar } from '../src/types.js';

const indicators = (over: Partial<BcbIndicators> = {}): BcbIndicators => ({
  selic: null, cdi: null, ipca12m: null, ipcaMes: null, igpm: null, dolar: null,
  unemployment: null, debtToGdp: null, reserves: null, ibcbr: null, realRate: null, ...over,
});
const ind = (label: string, value: number): Indicator => ({ label, value, unit: '', date: '' });

const region = (name: string, gdp: number, share: number) =>
  ({ region: name as never, gdp, share, population: null, gdpPerCapita: null, states: 1 });
const eduState = (uf: string, years: number, illiteracy: number | null = null) =>
  ({ uf, region: 'Sudeste' as never, yearsOfStudy: years, illiteracyRate: illiteracy });
const dengueAt = (city: string, level: number, incidence: number | null = null) => ({
  city, uf: 'BA', geocode: 1, level, levelLabel: ['', 'Verde', 'Amarelo', 'Laranja', 'Vermelho'][level]!,
  color: '#000', cases: 1, estimatedCases: 1, incidence100k: incidence, rt: null, week: 202629,
});
const newsItem = (title: string): NewsItem =>
  ({ source: 'Agência Brasil', agency: 'EBC', title, link: '', date: null, summary: '' });

describe('crossSignals — GDP concentration', () => {
  it('names the largest and smallest regions and flags a majority share', () => {
    const signals = crossSignals({ economy: {
      states: [], totalGdp: 10e12, gdpYear: '2023', populationYear: '2025',
      regions: [region('Sudeste', 5.3e12, 53), region('Norte', 0.58e12, 5.8)],
    } });
    const signal = signals.find(s => s.title.includes('do PIB'))!;
    assert.match(signal.title, /Sudeste concentra 53\.0%/);
    assert.match(signal.detail, /Norte responde por 5\.8%/);
    assert.equal(signal.level, 'medio');
  });

  it('stays informational when no region holds half the output', () => {
    const signals = crossSignals({ economy: {
      states: [], totalGdp: 10e12, gdpYear: '2023', populationYear: null,
      regions: [region('Sudeste', 4e12, 40), region('Sul', 3e12, 30)],
    } });
    assert.equal(signals.find(s => s.title.includes('do PIB'))!.level, 'info');
  });

  it('says nothing at all without economy data', () => {
    assert.equal(crossSignals({}).some(s => s.title.includes('do PIB')), false);
  });
});

describe('crossSignals — education spread', () => {
  it('reports the gap between the best and worst state', () => {
    const signals = crossSignals({ education: {
      states: [], regions: [], year: '2025', national: 10.1,
      best: eduState('DF', 12.1), worst: eduState('PB', 9.0, 11.6),
    } });
    const signal = signals.find(s => s.title.includes('Escolaridade'))!;
    assert.match(signal.title, /varia 3\.1 anos/);
    assert.match(signal.detail, /analfabetismo é de 11\.6%/);
    assert.equal(signal.level, 'medio');
  });

  it('is informational when the states are close together', () => {
    const signals = crossSignals({ education: {
      states: [], regions: [], year: '2025', national: 10.1,
      best: eduState('DF', 11.0), worst: eduState('SP', 10.0),
    } });
    assert.equal(signals.find(s => s.title.includes('Escolaridade'))!.level, 'info');
  });
});

describe('crossSignals — unemployment against the real rate', () => {
  const restrictive = indicators({ selic: ind('Selic', 15), ipca12m: ind('IPCA', 4) });

  it('escalates when high unemployment meets a restrictive real rate', () => {
    const signals = crossSignals({ unemployment: ind('Desocupação', 9.5), indicators: restrictive });
    const signal = signals.find(s => s.title.includes('Desocupação'))!;
    assert.equal(signal.level, 'alto');
    assert.match(signal.detail, /apertada sobre um mercado de trabalho/);
  });

  it('reads a tight labour market differently at the same real rate', () => {
    const signals = crossSignals({ unemployment: ind('Desocupação', 5.4), indicators: restrictive });
    const signal = signals.find(s => s.title.includes('Desocupação'))!;
    assert.equal(signal.level, 'medio');
    assert.match(signal.detail, /Mercado de trabalho apertado/);
  });

  it('needs both the policy rate and the inflation reading to fire', () => {
    assert.equal(crossSignals({ unemployment: ind('Desocupação', 9.5) })
      .some(s => s.title.includes('Desocupação')), false);
  });
});

describe('crossSignals — dengue', () => {
  it('only counts levels 3 and 4, and escalates on red', () => {
    const signals = crossSignals({ dengue: [dengueAt('Salvador', 4, 10.9), dengueAt('Recife', 3), dengueAt('São Paulo', 1)] });
    const signal = signals.find(s => s.title.includes('Dengue'))!;
    assert.match(signal.title, /nível vermelho em 2 capital/);
    assert.equal(signal.level, 'alto');
    assert.match(signal.detail, /Salvador \(Vermelho, 10\.9\/100mil\)/);
  });

  it('is medium when the worst capital is only orange', () => {
    assert.equal(crossSignals({ dengue: [dengueAt('Salvador', 3)] })
      .find(s => s.title.includes('Dengue'))!.level, 'medio');
  });

  it('says nothing while every capital is green or yellow', () => {
    assert.equal(crossSignals({ dengue: [dengueAt('a', 1), dengueAt('b', 2)] })
      .some(s => s.title.includes('Dengue')), false);
  });
});

describe('crossSignals — crisis vocabulary in official headlines', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => newsItem(`nota tranquila ${i}`));

  it('needs at least 8 headlines before it will read a share', () => {
    assert.equal(crossSignals({ news: [newsItem('crise no setor'), ...filler(3)] })
      .some(s => s.title.includes('manchetes oficiais')), false);
  });

  it('escalates past 30% of headlines', () => {
    const signals = crossSignals({ news: [
      newsItem('crise hídrica'), newsItem('greve dos servidores'),
      newsItem('enchente no sul'), newsItem('CPI instalada'), ...filler(6),
    ] });
    const signal = signals.find(s => s.title.includes('manchetes oficiais'))!;
    assert.match(signal.title, /40% das manchetes/);
    assert.equal(signal.level, 'medio');
  });

  it('stays informational at a low share', () => {
    assert.equal(crossSignals({ news: [newsItem('crise hídrica'), ...filler(19)] })
      .find(s => s.title.includes('manchetes oficiais'))!.level, 'info');
  });

  it('says nothing when no headline matches', () => {
    assert.equal(crossSignals({ news: filler(20) }).some(s => s.title.includes('manchetes oficiais')), false);
  });
});

describe('crossSignals — Congress across both chambers', () => {
  const houseVote = (approved: boolean | null): CongressRadar['votes'][number] =>
    ({ id: 1, date: '2026-07-01', description: 'x', body: 'PL', approved, url: '' });
  const senateVote = (approved: boolean | null): SenateRadar['votes'][number] =>
    ({ date: '2026-07-01', subject: 'PEC 1', description: 'x', approved, secret: false, url: '' });
  const bill = (kind: string): SenateRadar['bills'][number] =>
    ({ code: 'PL 1/2026', year: 2026, kind, house: 'SF', summary: 'ementa', url: '' });

  it('merges both chambers into one tally', () => {
    const signals = crossSignals({
      congress: { proposals: [], votes: [houseVote(true), houseVote(false)] },
      senate: { bills: [], votes: [senateVote(true)] },
    });
    const signal = signals.find(s => s.title.includes('votações'))!;
    assert.match(signal.title, /3 votações recentes no Congresso/);
    assert.match(signal.detail, /2 na Câmara e 1 no Senado/);
    assert.match(signal.detail, /2 aprovada\(s\) · 1 rejeitada\(s\)/);
  });

  it('still fires with only one chamber reporting', () => {
    const signals = crossSignals({ senate: { bills: [], votes: [senateVote(true)] } });
    assert.match(signals.find(s => s.title.includes('votações'))!.detail, /^1 no Senado/);
  });

  it('summarises Senate bills by kind once there are at least three', () => {
    const signals = crossSignals({ senate: {
      votes: [], bills: [bill('Projeto de Lei'), bill('Projeto de Lei'), bill('Medida Provisória')],
    } });
    assert.match(signals.find(s => s.title.includes('matérias movimentadas'))!.detail,
      /Projeto de Lei \(2\), Medida Provisória \(1\)/);
  });

  it('does not summarise a thin bill list', () => {
    assert.equal(crossSignals({ senate: { votes: [], bills: [bill('PL'), bill('PL')] } })
      .some(s => s.title.includes('matérias movimentadas')), false);
  });
});
