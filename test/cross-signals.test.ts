import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crossSignals } from '../src/cross-signals.js';
import type {
  BcbIndicators, CapitalWeather, CongressRadar, Earthquake, RegionalBreakdown, TerritoryEvent, TesouroTitle, WeatherAlert,
} from '../src/types.js';

const indicators = (over: Partial<BcbIndicators> = {}): BcbIndicators => ({
  selic: null, cdi: null, ipca12m: null, ipcaMes: null, igpm: null, dolar: null,
  unemployment: null, debtToGdp: null, reserves: null, ibcbr: null, realRate: null, ...over,
});
const ind = (label: string, value: number): { label: string; value: number; unit: string; date: string } =>
  ({ label, value, unit: '', date: '' });

const alert = (severity: WeatherAlert['severity'], ufs: string[]): WeatherAlert =>
  ({ event: 'x', severity, ufs, risks: '', start: null, end: null, url: '' });

const weather = (city: string, over: Partial<CapitalWeather> = {}): CapitalWeather => ({
  city, uf: 'SP', temp: 25, emoji: '☀️', description: '', humidity: null, windKmh: null,
  max: null, min: null, rainChance: null, forecast: [], aqi: null, aqiLabel: null, aqiColor: null, pm25: null,
  ...over,
});

describe('crossSignals — real interest rate', () => {
  it('computes ex-post real rate and labels it restrictive at >=8%', () => {
    const signals = crossSignals({ indicators: indicators({ selic: ind('Selic', 15), ipca12m: ind('IPCA', 4) }) });
    const signal = signals.find(s => s.title.includes('Juro real'))!;
    // ((1.15/1.04)-1)*100 = 10.5769...
    assert.match(signal.title, /10\.58%/);
    assert.equal(signal.level, 'alto');
  });

  it('is absent when either rate is missing', () => {
    const signals = crossSignals({ indicators: indicators({ selic: ind('Selic', 15) }) });
    assert.equal(signals.some(s => s.title.includes('Juro real')), false);
  });

  it('classifies medio at 5-8% and info below', () => {
    const at = (selic: number, ipca: number) =>
      crossSignals({ indicators: indicators({ selic: ind('s', selic), ipca12m: ind('i', ipca) }) })
        .find(s => s.title.includes('Juro real'))!.level;
    assert.equal(at(10, 4), 'medio');   // ~5.77%
    assert.equal(at(4, 3.5), 'info');   // ~0.48%
  });
});

describe('crossSignals — Focus vs inflation target', () => {
  it('flags a gap over 1.5pp above target as alto', () => {
    const signals = crossSignals({ focus: { year: 2026, ipca: 5, selic: null, gdp: null, fx: null, date: null } });
    const signal = signals.find(s => s.title.includes('Focus projeta'))!;
    assert.equal(signal.level, 'alto');
    assert.match(signal.title, /5\.00%/);
  });

  it('is absent without a Focus reading', () => {
    assert.equal(crossSignals({ focus: null }).some(s => s.title.includes('Focus')), false);
  });
});

describe('crossSignals — risk-off / risk-on', () => {
  it('flags simultaneous dollar-up and Ibovespa-down as risk-off', () => {
    const signals = crossSignals({ market: { dolarChangePct: 0.5, ibovChangePct: -0.4 } });
    const signal = signals.find(s => s.title.includes('Risk-off'))!;
    assert.equal(signal.level, 'alto');
  });

  it('flags the mirror case as risk-on', () => {
    const signals = crossSignals({ market: { dolarChangePct: -0.5, ibovChangePct: 0.4 } });
    assert.ok(signals.find(s => s.title.includes('Risk-on')));
  });

  it('stays silent when both move the same direction', () => {
    const signals = crossSignals({ market: { dolarChangePct: 0.5, ibovChangePct: 0.4 } });
    assert.equal(signals.some(s => /Risk-(on|off)/.test(s.title)), false);
  });

  it('respects the 0.3pp threshold on both legs', () => {
    const signals = crossSignals({ market: { dolarChangePct: 0.2, ibovChangePct: -0.2 } });
    assert.equal(signals.some(s => /Risk-off/.test(s.title)), false);
  });
});

describe('crossSignals — agro belt weather', () => {
  it('fires only for agro states above amarelo severity', () => {
    const signals = crossSignals({ alerts: [alert('laranja', ['MT']), alert('amarelo', ['GO'])] });
    const signal = signals.find(s => s.title.includes('cinturão agrícola'))!;
    assert.match(signal.title, /1 UF/);
  });

  it('escalates to alto at 3+ affected states', () => {
    const signals = crossSignals({ alerts: [alert('vermelho', ['MT', 'GO', 'RS'])] });
    assert.equal(signals.find(s => s.title.includes('cinturão'))!.level, 'alto');
  });

  it('ignores non-agro states entirely', () => {
    const signals = crossSignals({ alerts: [alert('vermelho', ['RJ'])] });
    assert.equal(signals.some(s => s.title.includes('cinturão')), false);
  });

  it('includes commodity quotes in the detail when supplied', () => {
    const signals = crossSignals({
      alerts: [alert('laranja', ['MT'])],
      market: { soybeanChangePct: 1.2, cornChangePct: -0.4 },
    });
    assert.match(signals.find(s => s.title.includes('cinturão'))!.detail, /Soja \+1\.2%.*Milho -0\.4%/);
  });
});

describe('crossSignals — fire window', () => {
  it('fires at 2+ capitals under 35% humidity', () => {
    const signals = crossSignals({ weather: [weather('A', { humidity: 20 }), weather('B', { humidity: 30 })] });
    assert.ok(signals.find(s => s.title.includes('incêndio')));
  });

  it('fires with 1 dry capital when 3+ wildfires are already open', () => {
    const events: TerritoryEvent[] = Array.from({ length: 3 }, () => ({ source: 'EONET', type: 'x', title: 'wildfire', severity: 'green', lat: 0, lon: 0, date: null, url: null }));
    const signals = crossSignals({ weather: [weather('A', { humidity: 20 })], events });
    assert.ok(signals.find(s => s.title.includes('incêndio')));
  });

  it('stays silent with only 1 dry capital and no fires', () => {
    const signals = crossSignals({ weather: [weather('A', { humidity: 20 })] });
    assert.equal(signals.some(s => s.title.includes('incêndio')), false);
  });
});

describe('crossSignals — air quality', () => {
  it('flags capitals at AQI 60+, ranking the worst first', () => {
    const signals = crossSignals({ weather: [weather('Bom', { aqi: 45 }), weather('Ruim', { aqi: 85, aqiLabel: 'Muito ruim' })] });
    const signal = signals.find(s => s.title.includes('Ar ruim'))!;
    assert.match(signal.title, /1 capital/);
    assert.equal(signal.level, 'alto');
    assert.match(signal.detail, /^Ruim/);
  });
});

describe('crossSignals — regional concentration', () => {
  const regional = (over: Partial<RegionalBreakdown>[]): RegionalBreakdown[] => over.map(r => ({
    region: 'Sul', count: 0, worst: null, ...r,
  })) as RegionalBreakdown[];

  it('requires at least 3 incidents in the worst region', () => {
    const signals = crossSignals({ regional: regional([{ count: 2, worst: 'laranja' }]) });
    assert.equal(signals.some(s => s.title.includes('concentra')), false);
  });

  it('reports the percentage share correctly', () => {
    const signals = crossSignals({ regional: [
      { region: 'Sul', count: 6, worst: 'laranja' },
      { region: 'Norte', count: 2, worst: 'amarelo' },
    ] });
    const signal = signals.find(s => s.title.includes('concentra'))!;
    assert.match(signal.title, /75%/);
    assert.equal(signal.level, 'medio'); // 75% > 50%
  });
});

describe('crossSignals — Tesouro yield curve', () => {
  const title = (name: string, maturity: string, rate: number): TesouroTitle =>
    ({ name, maturity, buyRate: rate, sellRate: rate, buyPrice: null });

  it('detects an inverted curve between the shortest and longest prefixado', () => {
    const signals = crossSignals({ tesouro: [
      title('Tesouro Prefixado', '2027-01-01', 12),
      title('Tesouro Prefixado', '2031-01-01', 11),
    ] });
    const signal = signals.find(s => s.title.includes('Curva'))!;
    assert.match(signal.title, /invertida/);
    assert.equal(signal.level, 'medio');
  });

  it('reports a positive slope as info', () => {
    const signals = crossSignals({ tesouro: [
      title('Tesouro Prefixado', '2027-01-01', 10),
      title('Tesouro Prefixado', '2031-01-01', 12),
    ] });
    assert.equal(signals.find(s => s.title.includes('Curva'))!.level, 'info');
  });

  it('reads the long end of IPCA+, not the highest short rate', () => {
    const signals = crossSignals({ tesouro: [
      title('Tesouro IPCA+', '2027-01-01', 9), // short but high — must NOT be picked
      title('Tesouro IPCA+', '2035-01-01', 6.5),
    ] });
    const signal = signals.find(s => s.title.includes('IPCA+ longo'))!;
    assert.match(signal.title, /6\.5%/);
    assert.equal(signal.level, 'info'); // below the 7% threshold
  });

  it('flags a long real rate above 7% as medio', () => {
    const signals = crossSignals({ tesouro: [title('Tesouro IPCA+', '2035-01-01', 7.5)] });
    assert.equal(signals.find(s => s.title.includes('IPCA+ longo'))!.level, 'medio');
  });
});

describe('crossSignals — earthquakes', () => {
  it('only counts M3.5+', () => {
    const quakes: Earthquake[] = [{ mag: 3.0, place: 'a', time: null, lat: 0, lon: 0, url: null }];
    assert.equal(crossSignals({ quakes }).some(s => s.title.includes('sismo')), false);
  });

  it('reports M3.5+ events', () => {
    const quakes: Earthquake[] = [{ mag: 4.1, place: 'a', time: null, lat: 0, lon: 0, url: null }];
    const signal = crossSignals({ quakes }).find(s => s.title.includes('sismo'))!;
    assert.equal(signal.level, 'info');
    assert.match(signal.title, /1 sismo/);
  });
});

describe('crossSignals — Congress votes', () => {
  it('summarises approved vs rejected', () => {
    const congress: CongressRadar = {
      proposals: [],
      votes: [
        { id: 1, date: null, subject: '', description: '', body: '', approved: true, url: '' },
        { id: 2, date: null, subject: '', description: '', body: '', approved: false, url: '' },
        { id: 3, date: null, subject: '', description: '', body: '', approved: null, url: '' },
      ],
    };
    const signal = crossSignals({ congress }).find(s => s.title.includes('votações'))!;
    assert.match(signal.detail, /1 aprovada.*1 rejeitada/);
  });
});

describe('crossSignals — ordering', () => {
  it('sorts alto before medio before info', () => {
    const signals = crossSignals({
      indicators: indicators({ selic: ind('s', 15), ipca12m: ind('i', 2) }),   // alto (real rate ~12.7%)
      quakes: [{ mag: 4, place: 'x', time: null, lat: 0, lon: 0, url: null }],  // info
      focus: { year: 2026, ipca: 3.8, selic: null, gdp: null, fx: null, date: null }, // medio (gap 0.8)
    });
    const levels = signals.map(s => s.level);
    const firstInfo = levels.indexOf('info');
    const lastAlto = levels.lastIndexOf('alto');
    assert.ok(firstInfo === -1 || lastAlto === -1 || lastAlto < firstInfo);
  });

  it('returns nothing for empty inputs', () => {
    assert.deepEqual(crossSignals({}), []);
  });
});
