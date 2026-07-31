import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchActiveAlerts, regionalBreakdown } from '../src/sensors/weather-alerts.js';
import { fetchIbgeNews, fetchPopulation } from '../src/sensors/ibge.js';
import { parseTesouroCsv } from '../src/sensors/tesouro.js';
import { fetchIndicators, fetchFocusExpectations } from '../src/sensors/bcb.js';
import { fetchCongressRadar, fetchAgenda } from '../src/sensors/congress.js';
import { fetchTerritoryEvents, fetchEarthquakes, BRAZIL_BBOX } from '../src/sensors/territory-events.js';
import { fetchCapitalsClimate } from '../src/sensors/climate.js';
import { fetchUpcomingHolidays } from '../src/sensors/holidays.js';
import { foldAccents, STATE_CENTROID, STATE_REGION } from '../src/geo.js';

const realFetch = globalThis.fetch;
function mockFetch(handler: (url: string) => { status?: number; json?: unknown; text?: string }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const result = handler(url);
    const status = result.status ?? 200;
    if (result.text !== undefined) return new Response(result.text, { status });
    return new Response(JSON.stringify(result.json ?? null), { status });
  }) as typeof fetch;
}

beforeEach(() => { /* each test installs its own mock */ });
afterEach(() => { globalThis.fetch = realFetch; });

describe('fetchActiveAlerts', () => {
  it('parses the flat-array response shape', async () => {
    mockFetch(() => ({ json: [
      { descricao: 'Chuva intensa', severidade: 'Perigo', estados: 'Rio de Janeiro, São Paulo' },
    ] }));
    const alerts = await fetchActiveAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.event, 'Chuva intensa');
    assert.equal(alerts[0]!.severity, 'laranja');
    assert.deepEqual(alerts[0]!.ufs, ['RJ', 'SP']);
  });

  it('parses the {hoje,futuro,avisos} response shape', async () => {
    mockFetch(() => ({ json: {
      hoje: [{ descricao: 'A', severidade: 'grande perigo', estados: 'Bahia' }],
      futuro: [{ descricao: 'B', severidade: 'perigo potencial', estados: 'acre' }],
    } }));
    const alerts = await fetchActiveAlerts();
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0]!.severity, 'vermelho');
    assert.equal(alerts[1]!.severity, 'amarelo');
    assert.deepEqual(alerts[1]!.ufs, ['AC']);
  });

  it('falls back to extracting UF codes from municipality text', async () => {
    mockFetch(() => ({ json: [
      { descricao: 'X', severidade: 'Perigo', estados: '', municipios: 'Porto Alegre - RS, Curitiba - PR' },
    ] }));
    const alerts = await fetchActiveAlerts();
    assert.deepEqual(alerts[0]!.ufs, ['RS', 'PR']);
  });

  it('returns an empty list when the endpoint is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    assert.deepEqual(await fetchActiveAlerts(), []);
  });

  it('returns an empty list on a non-200 response', async () => {
    mockFetch(() => ({ status: 500, json: null }));
    assert.deepEqual(await fetchActiveAlerts(), []);
  });
});

describe('regionalBreakdown', () => {
  it('groups by IBGE region and tracks the worst severity per region', () => {
    const alerts = [
      { event: 'a', severity: 'laranja' as const, ufs: ['SP', 'RJ'], risks: '', start: null, end: null, url: '' },
      { event: 'b', severity: 'vermelho' as const, ufs: ['SP'], risks: '', start: null, end: null, url: '' },
    ];
    const breakdown = regionalBreakdown(alerts);
    const sudeste = breakdown.find(r => r.region === 'Sudeste')!;
    assert.equal(sudeste.count, 3); // SP counted twice (2 alerts), RJ once
    assert.equal(sudeste.worst, 'vermelho');
  });

  it('always returns all 5 regions, even with no alerts', () => {
    assert.equal(regionalBreakdown([]).length, 5);
  });
});

describe('fetchIbgeNews / fetchPopulation', () => {
  it('maps the news payload', async () => {
    mockFetch(() => ({ json: { items: [{ titulo: 'T', introducao: 'I', data_publicacao: '2026-01-01', link: 'L', tipo: 'Notícia' }] } }));
    const news = await fetchIbgeNews();
    assert.equal(news[0]!.title, 'T');
  });

  it('reads the population projection', async () => {
    mockFetch(() => ({ json: { projecao: { populacao: 213000000 }, horizonte: '2026' } }));
    const pop = await fetchPopulation();
    assert.equal(pop!.total, 213000000);
  });

  it('returns null when the projection is missing', async () => {
    mockFetch(() => ({ json: {} }));
    assert.equal(await fetchPopulation(), null);
  });
});

describe('parseTesouroCsv', () => {
  const header = 'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha';
  const futureYear = new Date().getFullYear() + 5;

  it('keeps only the most recent quote per title', () => {
    const csv = [
      header,
      `Tesouro Prefixado;01/01/${futureYear};01/01/2026;10,50;10,60;900,00;901,00`,
      `Tesouro Prefixado;01/01/${futureYear};02/01/2026;10,80;10,90;902,00;903,00`,
    ].join('\n');
    const titles = parseTesouroCsv(csv);
    assert.equal(titles.length, 1);
    assert.equal(titles[0]!.buyRate, 10.80); // the later "Data Base" wins
  });

  it('drops titles that have already matured', () => {
    const csv = [header, `Tesouro Prefixado;01/01/2020;01/01/2019;10,00;10,10;900,00;901,00`].join('\n');
    assert.equal(parseTesouroCsv(csv).length, 0);
  });

  it('converts Brazilian decimal commas correctly', () => {
    const csv = [header, `Tesouro IPCA+;01/01/${futureYear};01/01/2026;6,25;6,35;1000,50;1001,50`].join('\n');
    const titles = parseTesouroCsv(csv);
    assert.equal(titles[0]!.buyRate, 6.25);
    assert.equal(titles[0]!.buyPrice, 1000.50);
  });

  it('reformats the maturity date to ISO order', () => {
    const csv = [header, `Tesouro Selic;25/12/${futureYear};01/01/2026;0,10;0,15;100,00;101,00`].join('\n');
    assert.equal(parseTesouroCsv(csv)[0]!.maturity, `${futureYear}-12-25`);
  });

  it('caps the result at 16 titles', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      `Tesouro Prefixado ${i};01/01/${futureYear};01/01/2026;${i}.5;${i}.6;900,00;901,00`.replace('.', ','));
    assert.ok(parseTesouroCsv([header, ...rows].join('\n')).length <= 16);
  });
});

describe('fetchIndicators', () => {
  it('computes the ex-post real rate from Selic and 12m IPCA', async () => {
    mockFetch(url => {
      if (url.includes('.432/')) return { json: [{ valor: '15.00', data: '01/01/2026' }] }; // selic
      if (url.includes('.13522/')) return { json: [{ valor: '4.00', data: '01/01/2026' }] }; // ipca12m
      return { json: [] };
    });
    const indicators = await fetchIndicators();
    assert.equal(indicators.selic!.value, 15);
    assert.ok(indicators.realRate);
    assert.match(String(indicators.realRate!.value), /10\.5/);
  });

  it('omits the real rate when either input is missing', async () => {
    mockFetch(() => ({ json: [] }));
    const indicators = await fetchIndicators();
    assert.equal(indicators.realRate, null);
  });
});

describe('fetchFocusExpectations', () => {
  it('picks the most recent median per indicator', async () => {
    mockFetch(() => ({ json: { value: [
      { Indicador: 'IPCA', Data: '2026-01-01', DataReferencia: '2026', Mediana: 4.2 },
      { Indicador: 'Selic', Data: '2026-01-01', DataReferencia: '2026', Mediana: 11.5 },
    ] } }));
    const focus = await fetchFocusExpectations();
    assert.equal(focus!.ipca, 4.2);
    assert.equal(focus!.selic, 11.5);
  });
});

describe('fetchCongressRadar / fetchAgenda', () => {
  it('maps proposals and votes', async () => {
    mockFetch(url => {
      if (url.includes('proposicoes')) return { json: { dados: [{ id: 1, siglaTipo: 'PL', numero: '123', ano: '2026', ementa: 'x' }] } };
      if (url.includes('votacoes')) return { json: { dados: [{ id: 2, dataHoraRegistro: 'd', descricao: 'y', siglaOrgao: 'PLEN', aprovacao: 1 }] } };
      return { json: {} };
    });
    const radar = await fetchCongressRadar();
    assert.equal(radar.proposals[0]!.code, 'PL 123/2026');
    assert.equal(radar.votes[0]!.approved, true);
  });

  it('maps agenda items', async () => {
    mockFetch(() => ({ json: { dados: [{ id: 1, dataHoraInicio: 'd', descricaoTipo: 'Reunião' }] } }));
    const agenda = await fetchAgenda();
    assert.equal(agenda[0]!.type, 'Reunião');
  });
});

describe('fetchTerritoryEvents', () => {
  it('keeps only events inside the Brazil bounding box', async () => {
    mockFetch(url => {
      if (url.includes('eonet')) return { json: { events: [
        { title: 'In BR', categories: [{ title: 'Wildfires' }], geometry: [{ coordinates: [-47, -15], date: 'd' }] },
        { title: 'Outside', categories: [{ title: 'Wildfires' }], geometry: [{ coordinates: [10, 50], date: 'd' }] },
      ] } };
      if (url.includes('gdacs')) return { json: { features: [] } };
      return { json: {} };
    });
    const events = await fetchTerritoryEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.title, 'In BR');
  });

  it('classifies high-impact EONET categories as orange, others as green', async () => {
    mockFetch(url => {
      if (url.includes('eonet')) return { json: { events: [
        { title: 'Flood', categories: [{ title: 'Floods' }], geometry: [{ coordinates: [-47, -15] }] },
        { title: 'Small fire', categories: [{ title: 'Wildfires' }], geometry: [{ coordinates: [-47, -15] }] },
      ] } };
      return { json: { features: [] } };
    });
    const events = await fetchTerritoryEvents();
    assert.equal(events.find(e => e.title === 'Flood')!.severity, 'orange');
    assert.equal(events.find(e => e.title === 'Small fire')!.severity, 'green');
  });
});

describe('fetchEarthquakes', () => {
  it('maps USGS features to quakes', async () => {
    mockFetch(() => ({ json: { features: [
      { properties: { mag: 4.2, place: 'x', time: 123, url: 'u' }, geometry: { coordinates: [-47, -15] } },
    ] } }));
    const quakes = await fetchEarthquakes();
    assert.equal(quakes[0]!.mag, 4.2);
  });

  it('queries within the Brazil bbox constants', () => {
    assert.equal(BRAZIL_BBOX.minLat < BRAZIL_BBOX.maxLat, true);
  });
});

describe('fetchCapitalsClimate', () => {
  it('zips weather and air-quality responses by index', async () => {
    mockFetch(url => {
      if (url.includes('air-quality')) return { json: Array.from({ length: 12 }, () => ({ current: { european_aqi: 45, pm2_5: 10 } })) };
      return { json: Array.from({ length: 12 }, () => ({
        current: { temperature_2m: 28, relative_humidity_2m: 60, weather_code: 0, wind_speed_10m: 10 },
        daily: { time: ['2026-01-01'], temperature_2m_max: [30], temperature_2m_min: [22], precipitation_probability_max: [10] },
      })) };
    });
    const climate = await fetchCapitalsClimate();
    assert.equal(climate.length, 12);
    assert.equal(climate[0]!.temp, 28);
    assert.equal(climate[0]!.aqi, 45);
  });
});

describe('fetchUpcomingHolidays', () => {
  it('filters to future dates and computes days-away', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    mockFetch(() => ({ json: [
      { date: future, name: 'Future Day', type: 'national' },
      { date: past, name: 'Past Day', type: 'national' },
    ] }));
    const holidays = await fetchUpcomingHolidays();
    assert.equal(holidays.length, 1);
    assert.equal(holidays[0]!.name, 'Future Day');
    assert.ok(holidays[0]!.daysAway >= 9);
  });
});

describe('geo helpers', () => {
  it('folds accents and case for state-name matching', () => {
    assert.equal(foldAccents('São Paulo'), 'sao paulo');
    assert.equal(foldAccents('ESPÍRITO SANTO'), 'espirito santo');
  });

  it('has a centroid and a region for every state', () => {
    for (const uf of Object.keys(STATE_CENTROID)) {
      assert.ok(STATE_REGION[uf], `missing region for ${uf}`);
    }
    assert.equal(Object.keys(STATE_CENTROID).length, 27); // 26 states + DF
  });
});
