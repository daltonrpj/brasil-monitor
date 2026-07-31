import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRiskScore } from '../src/risk.js';
import type { TerritoryEvent, WeatherAlert } from '../src/types.js';

const alert = (severity: WeatherAlert['severity']): WeatherAlert => ({
  event: 'x', severity, ufs: ['SP'], risks: '', start: null, end: null, url: '',
});
const event = (severity: string): TerritoryEvent => ({
  source: 'EONET', type: 'x', title: 'x', severity, lat: 0, lon: 0, date: null, url: null,
});

describe('computeRiskScore — climate component', () => {
  it('is zero with no alerts', () => {
    const result = computeRiskScore({});
    assert.equal(result.parts.find(p => p.key === 'clima')!.score, 0);
  });

  it('weighs red 30, orange 10, plus 2 per total alert', () => {
    const result = computeRiskScore({ alerts: [alert('vermelho'), alert('laranja'), alert('amarelo')] });
    // 1*30 + 1*10 + 3*2 = 46
    assert.equal(result.parts.find(p => p.key === 'clima')!.score, 46);
  });

  it('caps at 100', () => {
    const alerts = Array.from({ length: 10 }, () => alert('vermelho'));
    const result = computeRiskScore({ alerts });
    assert.equal(result.parts.find(p => p.key === 'clima')!.score, 100);
  });
});

describe('computeRiskScore — territory component', () => {
  it('weighs red 25, orange 6', () => {
    const result = computeRiskScore({ events: [event('red'), event('orange'), event('orange')] });
    // 25 + 2*6 = 37
    assert.equal(result.parts.find(p => p.key === 'ambiental')!.score, 37);
  });

  it('green events do not count', () => {
    const result = computeRiskScore({ events: [event('green'), event('green')] });
    assert.equal(result.parts.find(p => p.key === 'ambiental')!.score, 0);
  });
});

describe('computeRiskScore — FX and equity components', () => {
  it('omits the FX component entirely when no dollar move is given', () => {
    const result = computeRiskScore({});
    assert.equal(result.parts.some(p => p.key === 'cambial'), false);
  });

  it('scales dollar-up moves at 45x, capped at 100', () => {
    assert.equal(computeRiskScore({ dolarChangePct: 1 }).parts.find(p => p.key === 'cambial')!.score, 45);
    assert.equal(computeRiskScore({ dolarChangePct: 3 }).parts.find(p => p.key === 'cambial')!.score, 100);
  });

  it('a falling dollar is not currency stress — score floors at zero, not negative', () => {
    assert.equal(computeRiskScore({ dolarChangePct: -2 }).parts.find(p => p.key === 'cambial')!.score, 0);
  });

  it('scales Ibovespa-down moves at 40x; a rising index is not equity stress', () => {
    assert.equal(computeRiskScore({ ibovChangePct: -1 }).parts.find(p => p.key === 'bolsa')!.score, 40);
    assert.equal(computeRiskScore({ ibovChangePct: 2 }).parts.find(p => p.key === 'bolsa')!.score, 0);
  });
});

describe('computeRiskScore — news component', () => {
  it('is present even with zero headlines, scoring zero', () => {
    const result = computeRiskScore({});
    assert.equal(result.parts.find(p => p.key === 'noticias')!.score, 0);
  });

  it('scores the share of headlines matching a crisis keyword, times 300, capped', () => {
    const headlines = [{ title: 'Governo enfrenta CPI' }, { title: 'Time vence jogo' }, { title: 'Nova exposição de arte' }];
    // 1/3 * 300 = 100
    assert.equal(computeRiskScore({ headlines }).parts.find(p => p.key === 'noticias')!.score, 100);
  });

  it('matches crisis keywords case-insensitively across the whole list', () => {
    const headlines = ['crise', 'escândalo', 'CPI', 'impeachment', 'greve', 'apagão', 'enchente', 'tragédia', 'operação', 'queda', 'colapso']
      .map(word => ({ title: `manchete sobre ${word} hoje` }));
    const result = computeRiskScore({ headlines });
    assert.equal(result.parts.find(p => p.key === 'noticias')!.score, 100);
  });
});

describe('computeRiskScore — composite and level', () => {
  it('averages every present component', () => {
    // clima=0, ambiental=0, noticias=0 always present; no dolar/ibov given.
    const result = computeRiskScore({});
    assert.equal(result.score, 0);
    assert.equal(result.parts.length, 3);
  });

  it('classifies level at the documented boundaries', () => {
    assert.equal(computeRiskScore({ alerts: [] }).level, 'baixo');

    // With 300 total headlines, the news component equals the crisis count
    // exactly (round(crisis/300*300) = crisis) — no rounding ambiguity. Below
    // 34, news alone (clima=ambiental=0) reaches the composite; 34 and above
    // needs clima maxed out too, since news alone caps the average at 33.
    const headlinesWith = (crisisCount: number) => [
      ...Array.from({ length: crisisCount }, () => ({ title: 'crise' })),
      ...Array.from({ length: 300 - crisisCount }, () => ({ title: 'ok' })),
    ];
    const newsOnly = (crisisCount: number) => computeRiskScore({ headlines: headlinesWith(crisisCount) });

    // clima=100 via 4 red alerts (4*30 + 4*2 = 128, capped at 100).
    const withMaxClima = (crisisCount: number) => computeRiskScore({
      alerts: Array.from({ length: 4 }, () => alert('vermelho')),
      headlines: headlinesWith(crisisCount),
    });

    // (0 + 0 + 63) / 3 = 21 → baixo. (0 + 0 + 66) / 3 = 22 → moderado.
    assert.equal(newsOnly(63).score, 21);
    assert.equal(newsOnly(63).level, 'baixo');
    assert.equal(newsOnly(66).score, 22);
    assert.equal(newsOnly(66).level, 'moderado');

    // (100 + 0 + 17) / 3 = 39 → moderado. (100 + 0 + 20) / 3 = 40 → elevado.
    assert.equal(withMaxClima(17).score, 39);
    assert.equal(withMaxClima(17).level, 'moderado');
    assert.equal(withMaxClima(20).score, 40);
    assert.equal(withMaxClima(20).level, 'elevado');

    // (100 + 0 + 77) / 3 = 59 → elevado. (100 + 0 + 80) / 3 = 60 → crítico.
    assert.equal(withMaxClima(77).score, 59);
    assert.equal(withMaxClima(77).level, 'elevado');
    assert.equal(withMaxClima(80).score, 60);
    assert.equal(withMaxClima(80).level, 'crítico');
  });

  it('stamps a timestamp', () => {
    const before = Date.now();
    const result = computeRiskScore({});
    assert.ok(result.at >= before);
  });
});

const dengue = (level: number) => ({
  city: 'x', uf: 'SP', geocode: 1, level, levelLabel: 'x', color: '#000',
  cases: 0, estimatedCases: 0, incidence100k: null, rt: null, week: 202629,
});

describe('computeRiskScore — health component', () => {
  it('is absent entirely when no dengue data is supplied', () => {
    const result = computeRiskScore({ alerts: [alert('vermelho')] });
    assert.equal(result.parts.some(p => p.key === 'saude'), false);
    assert.equal(result.parts.length, 3); // the original clima/ambiental/notícias trio
  });

  it('scores nothing while every capital is green or yellow', () => {
    const result = computeRiskScore({ dengue: [dengue(1), dengue(2), dengue(2)] });
    assert.equal(result.parts.find(p => p.key === 'saude')!.score, 0);
  });

  it('weighs red 34 and orange 8', () => {
    const result = computeRiskScore({ dengue: [dengue(4), dengue(3), dengue(3)] });
    // 34 + 2*8 = 50
    assert.equal(result.parts.find(p => p.key === 'saude')!.score, 50);
  });

  it('caps at 100 — three red capitals max it out', () => {
    const result = computeRiskScore({ dengue: [dengue(4), dengue(4), dengue(4)] });
    assert.equal(result.parts.find(p => p.key === 'saude')!.score, 100);
  });

  it('leaves the original five components byte-identical when dengue is omitted', () => {
    const inputs = {
      alerts: [alert('vermelho'), alert('laranja')],
      events: [event('red')],
      dolarChangePct: 1.0, ibovChangePct: -1.0,
      headlines: [{ title: 'crise no setor' }, { title: 'tudo calmo' }],
    };
    const before = computeRiskScore(inputs);
    const after = computeRiskScore({ ...inputs, dengue: [] });
    assert.deepEqual(before.parts, after.parts);
    assert.equal(before.score, after.score);
  });
});
