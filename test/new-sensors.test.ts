import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sidraRows, sidraValue } from '../src/sensors/sidra.js';
import { fetchRegionalEconomy, fetchUnemployment } from '../src/sensors/economy.js';
import { fetchEducation } from '../src/sensors/education.js';
import { decodeXml, tagText, parseRss, fetchOfficialNews } from '../src/sensors/news.js';
import { fetchSenateRadar } from '../src/sensors/senate.js';
import { fetchDengueAlerts, latestWeek } from '../src/sensors/health.js';

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

afterEach(() => { globalThis.fetch = realFetch; });

const SIDRA_HEADER = { NC: 'Nível Territorial (Código)', V: 'Valor', D1N: 'Unidade da Federação' };

describe('SIDRA envelope', () => {
  it('drops the header row', () => {
    assert.deepEqual(sidraRows([SIDRA_HEADER, { V: '1' }, { V: '2' }]), [{ V: '1' }, { V: '2' }]);
  });

  it('returns nothing for a payload with only a header, or no payload at all', () => {
    assert.deepEqual(sidraRows([SIDRA_HEADER]), []);
    assert.deepEqual(sidraRows(null), []);
    assert.deepEqual(sidraRows({ error: 'boom' }), []);
  });

  it('reads SIDRA\'s missing-data markers as null, never as zero', () => {
    // The trap: Number('') is 0, so a naive Number() cast turns "no data"
    // into a real-looking observation.
    assert.equal(sidraValue({ V: '..' }), null);
    assert.equal(sidraValue({ V: '-' }), null);
    assert.equal(sidraValue({ V: '...' }), null);
    assert.equal(sidraValue({ V: '' }), null);
    assert.equal(sidraValue({}), null);
    assert.equal(sidraValue({ V: '9.5' }), 9.5);
    assert.equal(sidraValue({ V: ' 12 ' }), 12);
  });
});

function gdpRow(name: string, value: string, year = '2023') {
  return { V: value, D1N: name, D3N: year };
}

describe('fetchRegionalEconomy', () => {
  it('folds states into IBGE regions and computes shares and per-capita', async () => {
    mockFetch(url => {
      if (url.includes('t/5938')) return { json: [SIDRA_HEADER,
        gdpRow('São Paulo', '3000'),    // 3 bi
        gdpRow('Rio de Janeiro', '1000'),
        gdpRow('Paraná', '1000'),
      ] };
      return { json: [SIDRA_HEADER,
        gdpRow('São Paulo', '1000', '2025'),
        gdpRow('Rio de Janeiro', '500', '2025'),
        gdpRow('Paraná', '500', '2025'),
      ] };
    });

    const economy = await fetchRegionalEconomy();
    assert.equal(economy.gdpYear, '2023');
    assert.equal(economy.populationYear, '2025');
    assert.equal(economy.totalGdp, 5_000_000); // thousands of BRL, multiplied out

    const sudeste = economy.regions.find(r => r.region === 'Sudeste')!;
    assert.equal(sudeste.states, 2);
    assert.equal(sudeste.gdp, 4_000_000);
    assert.equal(sudeste.share, 80);
    assert.equal(sudeste.gdpPerCapita, 4_000_000 / 1500);

    const sul = economy.regions.find(r => r.region === 'Sul')!;
    assert.equal(sul.share, 20);
    assert.equal(economy.regions.some(r => r.region === 'Norte'), false); // no data, no row
  });

  it('sorts states by GDP and survives states missing a population figure', async () => {
    mockFetch(url => url.includes('t/5938')
      ? { json: [SIDRA_HEADER, gdpRow('Acre', '10'), gdpRow('São Paulo', '900')] }
      : { json: [SIDRA_HEADER, gdpRow('São Paulo', '100', '2025')] });

    const economy = await fetchRegionalEconomy();
    assert.deepEqual(economy.states.map(s => s.uf), ['SP', 'AC']);
    assert.equal(economy.states[1]!.population, null);
    assert.equal(economy.states[1]!.gdpPerCapita, null);
  });

  it('degrades to an empty result when SIDRA is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    const economy = await fetchRegionalEconomy();
    assert.deepEqual(economy.states, []);
    assert.deepEqual(economy.regions, []);
    assert.equal(economy.totalGdp, 0);
  });
});

describe('fetchUnemployment', () => {
  it('reads the single national observation', async () => {
    mockFetch(() => ({ json: [SIDRA_HEADER, { V: '5.4', D3N: 'abr-mai-jun 2026' }] }));
    const indicator = await fetchUnemployment();
    assert.equal(indicator?.value, 5.4);
    assert.equal(indicator?.unit, '%');
    assert.equal(indicator?.date, 'abr-mai-jun 2026');
  });

  it('returns null rather than 0 when the period has no published value', async () => {
    mockFetch(() => ({ json: [SIDRA_HEADER, { V: '..', D3N: '2026' }] }));
    assert.equal(await fetchUnemployment(), null);
  });
});

describe('fetchEducation', () => {
  it('pins the Total classifications — without them SIDRA answers only ".."', async () => {
    const requested = new Set<string>();
    mockFetch(url => { requested.add(url); return { json: [SIDRA_HEADER] }; });
    await fetchEducation();
    // Two endpoints, each hit twice: an empty result is what a throttled SIDRA
    // looks like, so the helper retries once before believing it.
    assert.equal(requested.size, 2);
    for (const url of requested) {
      assert.ok(url.includes('c2/6794'), `missing the sex=Total cut: ${url}`);
      assert.ok(url.includes('c58/2795'), `missing the age=15+ cut: ${url}`);
    }
  });

  it('averages by region and reports the national spread', async () => {
    mockFetch(url => url.includes('t/7126')
      ? { json: [SIDRA_HEADER,
          { V: '12.1', D1N: 'Distrito Federal', D3N: '2025' },
          { V: '9.0', D1N: 'Paraíba', D3N: '2025' },
          { V: '11.0', D1N: 'Goiás', D3N: '2025' },
        ] }
      : { json: [SIDRA_HEADER,
          { V: '2.0', D1N: 'Distrito Federal', D3N: '2025' },
          { V: '11.6', D1N: 'Paraíba', D3N: '2025' },
        ] });

    const education = await fetchEducation();
    assert.equal(education.year, '2025');
    assert.equal(education.best?.uf, 'DF');
    assert.equal(education.worst?.uf, 'PB');
    assert.equal(education.national, (12.1 + 9.0 + 11.0) / 3);

    const centro = education.regions.find(r => r.region === 'Centro-Oeste')!;
    assert.equal(centro.states, 2);              // DF and GO
    assert.equal(centro.yearsOfStudy, 11.55);    // unweighted mean of 12.1 and 11.0

    // Goiás has no illiteracy row: it must be skipped, not averaged in as 0.
    assert.equal(centro.illiteracyRate, 2.0);
  });
});

describe('RSS parsing', () => {
  it('decodes the five XML entities', () => {
    assert.equal(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), `a & b <c> "d" 'e'`);
  });

  it('unwraps CDATA', () => {
    assert.equal(tagText('<title><![CDATA[Projeto & Lei]]></title>', 'title'), 'Projeto & Lei');
  });

  it('decodes entities before stripping tags, so escaped HTML does not survive', () => {
    // EBC ships descriptions as &lt;p&gt;… — strip-then-decode would leave "<p>" as text.
    const item = '<description>&lt;p&gt;Texto do &lt;b&gt;resumo&lt;/b&gt;&lt;/p&gt;</description>';
    assert.equal(tagText(item, 'description'), 'Texto do resumo');
  });

  it('reads title, link, date and summary out of an item', () => {
    const xml = `<rss><channel>
      <item><title>Primeira</title><link>https://x/1</link>
        <pubDate>Fri, 31 Jul 2026 15:34:00 GMT</pubDate><description>resumo um</description></item>
      <item><title>Segunda</title><link>https://x/2</link><pubDate>bogus</pubDate></item>
    </channel></rss>`;
    const items = parseRss(xml);
    assert.equal(items.length, 2);
    assert.equal(items[0]!.title, 'Primeira');
    assert.equal(items[0]!.link, 'https://x/1');
    assert.equal(items[0]!.date, '2026-07-31T15:34:00.000Z');
    assert.equal(items[0]!.summary, 'resumo um');
    assert.equal(items[1]!.date, null); // unparseable date, not a crash
  });

  it('honours the item limit and skips items without a title', () => {
    const xml = '<item><title>a</title></item><item></item><item><title>c</title></item>';
    assert.equal(parseRss(xml).length, 2);
    assert.equal(parseRss(xml, 1).length, 1);
  });
});

describe('fetchOfficialNews', () => {
  const feed = (title: string, date: string) =>
    `<rss><channel><item><title>${title}</title><link>https://x</link><pubDate>${date}</pubDate></item></channel></rss>`;

  it('tags each item with its agency and sorts newest first across all three', async () => {
    mockFetch(url => {
      if (url.includes('ebc')) return { text: feed('EBC item', 'Fri, 31 Jul 2026 10:00:00 GMT') };
      if (url.includes('camara')) return { text: feed('Câmara item', 'Fri, 31 Jul 2026 12:00:00 GMT') };
      return { text: feed('Senado item', 'Fri, 31 Jul 2026 11:00:00 GMT') };
    });

    const news = await fetchOfficialNews();
    assert.deepEqual(news.map(n => n.source), ['Câmara', 'Senado', 'Agência Brasil']);
    assert.equal(news[0]!.agency, 'Agência Câmara');
  });

  it('keeps the surviving feeds when one is down, and sinks undated items', async () => {
    mockFetch(url => {
      if (url.includes('ebc')) return { status: 503, text: '' };
      if (url.includes('camara')) return { text: '<item><title>sem data</title></item>' };
      return { text: feed('Senado item', 'Fri, 31 Jul 2026 11:00:00 GMT') };
    });

    const news = await fetchOfficialNews();
    assert.equal(news.length, 2);
    assert.equal(news[0]!.source, 'Senado');
    assert.equal(news[1]!.title, 'sem data');
  });
});

function materia(code: string, year: string, tramitando: string, kind = 'Projeto de Lei') {
  return {
    IdentificacaoMateria: {
      DescricaoIdentificacaoMateria: code, AnoMateria: year, IndicadorTramitando: tramitando,
      DescricaoSubtipoMateria: kind, NomeCasaIdentificacaoMateria: 'Senado Federal', CodigoMateria: '1',
    },
    DadosBasicosMateria: { EmentaMateria: 'Altera  a  lei\n   para  algo.' },
  };
}

describe('fetchSenateRadar', () => {
  it('drops archived bills and puts the newest ones first', async () => {
    mockFetch(url => url.includes('atualizadas')
      ? { json: { ListaMateriasAtualizadas: { Materias: { Materia: [
          materia('PDS 476/2012', '2012', 'Sim'),
          materia('PL 654/2026', '2026', 'Sim'),
          materia('PL 1/2027', '2027', 'Não'), // archived: excluded despite being newest
        ] } } } }
      : { json: {} });

    const radar = await fetchSenateRadar({ now: () => new Date('2026-07-31T00:00:00Z') });
    assert.deepEqual(radar.bills.map(b => b.code), ['PL 654/2026', 'PDS 476/2012']);
    assert.equal(radar.bills[0]!.summary, 'Altera a lei para algo.'); // source line wrapping collapsed
  });

  it('accepts a single object where the API would normally return an array', async () => {
    mockFetch(url => url.includes('atualizadas')
      ? { json: { ListaMateriasAtualizadas: { Materias: { Materia: materia('PL 9/2026', '2026', 'Sim') } } } }
      : { json: {} });
    const radar = await fetchSenateRadar();
    assert.equal(radar.bills.length, 1);
  });

  it('maps vote results and asks for a window ending today', async () => {
    let voteUrl = '';
    mockFetch(url => {
      if (url.includes('atualizadas')) return { json: {} };
      voteUrl = url;
      return { json: { ListaVotacoes: { Votacoes: { Votacao: [
        { DataSessao: '2026-07-14', Resultado: 'A', DescricaoIdentificacaoMateria: 'PEC 14/2021', DescricaoVotacao: 'Votação nominal', Secreta: 'N' },
        { DataSessao: '2026-07-15', Resultado: 'R', DescricaoIdentificacaoMateria: 'PLP 18/2021', DescricaoVotacao: 'Destaque', Secreta: 'S' },
        { DataSessao: '2026-07-13', Resultado: 'P', DescricaoIdentificacaoMateria: 'PL 1/2020', DescricaoVotacao: 'Prejudicada', Secreta: 'N' },
      ] } } } };
    });

    const radar = await fetchSenateRadar({ now: () => new Date('2026-07-31T00:00:00Z') });
    assert.ok(voteUrl.endsWith('/20260616/20260731'), voteUrl);
    assert.deepEqual(radar.votes.map(v => v.approved), [false, true, null]); // newest first; 'P' is neither
    assert.equal(radar.votes[0]!.secret, true);
  });

  it('returns empty lists when the Senate is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    assert.deepEqual(await fetchSenateRadar(), { bills: [], votes: [] });
  });
});

describe('fetchDengueAlerts', () => {
  it('picks the highest epidemiological week, not the last array element', () => {
    const week = latestWeek([{ SE: 202629 }, { SE: 202601 }, { SE: 202615 }]);
    assert.equal(week?.SE, 202629);
  });

  it('ignores rows without a week number and handles an empty year', () => {
    assert.equal(latestWeek([{ casos: 5 }] as never), null);
    assert.equal(latestWeek([]), null);
  });

  it('labels each level and sorts the worst capitals first', async () => {
    mockFetch(url => {
      const geocode = url.match(/geocode=(\d+)/)?.[1];
      const level = geocode === '2927408' ? 4 : geocode === '3550308' ? 1 : 2;
      return { json: [
        { SE: 202601, nivel: 1, casos: 1, casos_est: 1 },
        { SE: 202629, nivel: level, casos: 10, casos_est: 99.6, p_inc100k: 10.94, Rt: 1.0149 },
      ] };
    });

    const alerts = await fetchDengueAlerts({ now: () => new Date('2026-07-31T00:00:00Z') });
    assert.equal(alerts.length, 12);
    assert.equal(alerts[0]!.city, 'Salvador');
    assert.equal(alerts[0]!.levelLabel, 'Vermelho');
    assert.equal(alerts[0]!.estimatedCases, 100);      // rounded
    assert.equal(alerts[0]!.incidence100k, 10.9);
    assert.equal(alerts[0]!.rt, 1.01);
    assert.equal(alerts.at(-1)!.city, 'São Paulo');    // the only level-1 capital
    assert.equal(alerts.at(-1)!.levelLabel, 'Verde');
  });

  it('requests the epidemiological year of the supplied clock', async () => {
    let seen = '';
    mockFetch(url => { seen = url; return { json: [] }; });
    await fetchDengueAlerts({ now: () => new Date('2027-02-01T00:00:00Z') });
    assert.ok(seen.includes('ey_start=2027&ey_end=2027'), seen);
  });

  it('drops cities that answer with nothing instead of inventing a green level', async () => {
    mockFetch(url => url.includes('3550308') ? { json: [{ SE: 202629, nivel: 2 }] } : { json: [] });
    const alerts = await fetchDengueAlerts();
    assert.deepEqual(alerts.map(a => a.city), ['São Paulo']);
  });
});
