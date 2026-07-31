// ============================================================================
// Cross-signals — deterministic rules linking the data layers
//
// This is the actual thesis of the package: clima × mercado × macro ×
// território, cruzados sobre dados brutos, sem LLM. Every reading here is a
// plain rule over numbers — no model call, no randomness, always available,
// always auditable by reading the function below. An LLM can narrate these
// signals into prose (see the `brief` example), but it never decides them.
//
// Every threshold and formula below is unchanged from the private system
// this was extracted from — this file is the part where "identical" matters
// most, since the numbers are the product.
// ============================================================================

import type {
  BcbIndicators, CapitalWeather, CongressRadar, CrossSignal, DengueAlert, Earthquake,
  EducationSnapshot, FocusExpectations, Indicator, MarketSnapshot, NewsItem, RegionalBreakdown,
  RegionalEconomy, SenateRadar, TerritoryEvent, TesouroTitle, WeatherAlert,
} from './types.js';

const AGRO_STATES = new Set(['MT', 'GO', 'MS', 'PR', 'RS', 'BA', 'MG', 'SP']);
const LEVEL_ORDER = { alto: 0, medio: 1, info: 2 };

export interface CrossSignalInputs {
  alerts?: WeatherAlert[];
  events?: TerritoryEvent[];
  regional?: RegionalBreakdown[];
  weather?: CapitalWeather[];
  indicators?: BcbIndicators;
  focus?: FocusExpectations | null;
  market?: MarketSnapshot | null;
  tesouro?: TesouroTitle[];
  quakes?: Earthquake[];
  congress?: CongressRadar | null;
  economy?: RegionalEconomy | null;
  education?: EducationSnapshot | null;
  unemployment?: Indicator | null;
  news?: NewsItem[];
  senate?: SenateRadar | null;
  dengue?: DengueAlert[];
}

/** The same crisis vocabulary the risk index scans headlines with. */
export const CRISIS_KEYWORDS = /crise|escândalo|CPI|impeachment|greve|apagão|enchente|tragédia|operação|queda|colapso/i;

function brl(value: number): string {
  if (value >= 1e12) return `R$ ${(value / 1e12).toFixed(2)} tri`;
  if (value >= 1e9) return `R$ ${(value / 1e9).toFixed(1)} bi`;
  if (value >= 1e6) return `R$ ${(value / 1e6).toFixed(1)} mi`;
  return `R$ ${Math.round(value)}`;
}

function finite(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

export function crossSignals(inputs: CrossSignalInputs = {}): CrossSignal[] {
  const {
    alerts = [], events = [], regional = [], weather = [],
    indicators = {} as BcbIndicators, focus = null, market = null,
    tesouro = [], quakes = [], congress = null,
    economy = null, education = null, unemployment = null,
    news = [], senate = null, dengue = [],
  } = inputs;

  const out: CrossSignal[] = [];
  const push = (level: CrossSignal['level'], icon: string, title: string, detail: string) =>
    out.push({ level, icon, title, detail });

  // 1) Ex-post real rate (Selic vs 12-month IPCA) — the number that moves
  // Tesouro Direto and the stock market's multiples.
  const selic = finite(indicators.selic?.value);
  const ipca = finite(indicators.ipca12m?.value);
  if (selic != null && ipca != null) {
    const real = ((1 + selic / 100) / (1 + ipca / 100) - 1) * 100;
    push(
      real >= 8 ? 'alto' : real >= 5 ? 'medio' : 'info',
      '🏦', `Juro real de ${real.toFixed(2)}% a.a.`,
      `Selic ${selic}% contra IPCA 12m de ${ipca}%. ${
        real >= 8 ? 'Patamar historicamente restritivo — favorece renda fixa e pressiona múltiplos da bolsa.'
          : real >= 5 ? 'Juro real elevado: renda fixa segue competitiva com a B3.'
            : 'Juro real comprimido — cenário mais favorável a ativos de risco.'
      }`,
    );
  }

  // 2) Focus expectation vs. the inflation target (3.0%, ±1.5pp band).
  const focusIpca = finite(focus?.ipca);
  if (focusIpca != null && focus) {
    const gap = focusIpca - 3.0;
    push(
      gap > 1.5 ? 'alto' : gap > 0.5 ? 'medio' : 'info',
      '🎯', `Focus projeta IPCA de ${focusIpca.toFixed(2)}% para ${focus.year}`,
      gap > 1.5
        ? `Acima do teto da meta (4,5%) em ${(focusIpca - 4.5).toFixed(2)} p.p. — expectativas desancoradas sustentam juro alto por mais tempo.`
        : gap > 0.5
          ? `${gap.toFixed(2)} p.p. acima do centro da meta (3,0%), ainda dentro da banda.`
          : 'Praticamente no centro da meta (3,0%) — espaço para afrouxamento monetário.',
    );
  }

  // 3) Domestic risk-off/risk-on: dollar and Ibovespa moving against or with
  // each other on the same session.
  const dolarPct = finite(market?.dolarChangePct);
  const ibovPct = finite(market?.ibovChangePct);
  if (dolarPct != null && ibovPct != null) {
    if (dolarPct > 0.3 && ibovPct < -0.3) {
      push('alto', '🔻', 'Risk-off doméstico no pregão',
        `Dólar +${dolarPct}% e Ibovespa ${ibovPct}% ao mesmo tempo — saída simultânea de câmbio e bolsa costuma indicar estresse local (fiscal/político), não só humor externo.`);
    } else if (dolarPct < -0.3 && ibovPct > 0.3) {
      push('info', '🔼', 'Risk-on doméstico no pregão',
        `Dólar ${dolarPct}% e Ibovespa +${ibovPct}% — fluxo entrando em ativos brasileiros.`);
    }
  }

  // 4) Severe weather over the agricultural belt states, crossed with
  // commodity prices when available.
  const agroStatesHit = new Set<string>();
  for (const alert of alerts) {
    for (const uf of alert.ufs) {
      if (AGRO_STATES.has(uf) && alert.severity !== 'amarelo') agroStatesHit.add(uf);
    }
  }
  if (agroStatesHit.size) {
    const quotes = [
      market?.soybeanChangePct != null ? `Soja ${market.soybeanChangePct >= 0 ? '+' : ''}${market.soybeanChangePct}%` : null,
      market?.cornChangePct != null ? `Milho ${market.cornChangePct >= 0 ? '+' : ''}${market.cornChangePct}%` : null,
    ].filter(Boolean).join(' · ');
    push(
      agroStatesHit.size >= 3 ? 'alto' : 'medio',
      '🌾', `Alerta severo em ${agroStatesHit.size} UF do cinturão agrícola`,
      `${[...agroStatesHit].join(', ')} sob aviso do INMET acima de "perigo potencial". ${quotes ? `Commodities hoje: ${quotes}.` : ''} Clima adverso nessas UFs tende a se refletir em prêmio de risco na safra e no frete.`,
    );
  }

  // 5) Low humidity plus open wildfires = a critical fire-spread window.
  const dryCapitals = weather.filter(c => c.humidity != null && c.humidity < 35);
  const fireCount = events.filter(e => /fire|wildfire|incênd/i.test(`${e.type} ${e.title}`)).length;
  if (dryCapitals.length >= 2 || (fireCount >= 3 && dryCapitals.length)) {
    push(
      dryCapitals.length >= 4 ? 'alto' : 'medio',
      '🔥', 'Janela crítica de incêndio',
      `${dryCapitals.length} capital(is) com umidade abaixo de 35% (${dryCapitals.slice(0, 4).map(c => `${c.city} ${c.humidity}%`).join(', ')})${fireCount ? ` e ${fireCount} foco(s) de incêndio abertos no território` : ''}. Combinação clássica de propagação rápida e piora da qualidade do ar.`,
    );
  }

  // 6) Degraded air quality across capitals.
  const badAir = weather.filter(c => c.aqi != null && c.aqi >= 60).sort((a, b) => (b.aqi ?? 0) - (a.aqi ?? 0));
  if (badAir.length) {
    push(
      (badAir[0]!.aqi ?? 0) >= 80 ? 'alto' : 'medio',
      '😷', `Ar ruim em ${badAir.length} capital(is)`,
      `${badAir.slice(0, 4).map(c => `${c.city} AQI ${Math.round(c.aqi ?? 0)} (${c.aqiLabel})`).join(' · ')}. Índice europeu de qualidade do ar; acima de 60 já há recomendação de reduzir exercício ao ar livre.`,
    );
  }

  // 7) Regional concentration of active alerts.
  const worstRegion = [...regional].sort((a, b) => b.count - a.count)[0];
  if (worstRegion && worstRegion.count >= 3) {
    // `regional` counts alert×state pairs, so one alert covering 9 states
    // weighs 9 — the text has to say that explicitly or the numbers look wrong.
    const total = regional.reduce((sum, r) => sum + r.count, 0) || 1;
    push(
      worstRegion.count / total > 0.5 ? 'medio' : 'info',
      '🧭', `${worstRegion.region} concentra ${Math.round(worstRegion.count / total * 100)}% da cobertura de alertas`,
      `${worstRegion.count} de ${total} incidências alerta×estado (${alerts.length} avisos ativos espalhados pelas UFs) estão na região ${worstRegion.region}. Pior severidade: ${worstRegion.worst ?? '—'}.`,
    );
  }

  // 8) Implicit yield curve from Tesouro Direto (short vs. long prefixado).
  const prefixados = tesouro
    .filter(t => /Prefixado/i.test(t.name) && t.buyRate != null)
    .sort((a, b) => a.maturity.localeCompare(b.maturity));
  if (prefixados.length >= 2) {
    const short = prefixados[0]!, long = prefixados.at(-1)!;
    const slope = long.buyRate! - short.buyRate!;
    push(
      slope < 0 ? 'medio' : 'info',
      '📐', `Curva ${slope < 0 ? 'invertida' : 'positivamente inclinada'} (${slope >= 0 ? '+' : ''}${slope.toFixed(2)} p.p.)`,
      `Prefixado ${short.maturity.slice(0, 4)} a ${short.buyRate}% e ${long.maturity.slice(0, 4)} a ${long.buyRate}%. ${
        slope < 0 ? 'Inversão sinaliza mercado precificando cortes de juros à frente (ou desaceleração).'
          : 'Inclinação positiva: prêmio de prazo normal na ponta longa.'
      }`,
    );
  }

  // The LONG end of IPCA+ specifically — not the highest rate, since very
  // short maturities distort the real-rate read and don't represent the
  // term premium the market is actually demanding.
  const ipcaLong = tesouro
    .filter(t => /IPCA/i.test(t.name) && t.buyRate != null)
    .sort((a, b) => a.maturity.localeCompare(b.maturity))
    .at(-1);
  if (ipcaLong) {
    push(
      ipcaLong.buyRate! >= 7 ? 'medio' : 'info',
      '🛡️', `Tesouro IPCA+ longo pagando ${ipcaLong.buyRate}% + inflação`,
      `Vencimento ${ipcaLong.maturity.slice(0, 4)} — a ponta longa da curva real. ${
        ipcaLong.buyRate! >= 7 ? 'Juro real contratado acima de 7% a.a. é historicamente raro e costuma refletir prêmio de risco fiscal.'
          : 'Prêmio real dentro da média histórica recente.'
      }`,
    );
  }

  // 9) Earthquakes — rare in Brazil, always worth a line when they happen.
  const notableQuakes = quakes.filter(q => (q.mag ?? 0) >= 3.5);
  if (notableQuakes.length) {
    push(
      'info', '🌎', `${notableQuakes.length} sismo(s) M3.5+ no Brasil e fronteiras em 30 dias`,
      `${notableQuakes.slice(0, 3).map(q => `M${q.mag} ${q.place}`).join(' · ')}. Fonte USGS (janela cobre a bbox do país, incluindo faixa de fronteira); o Brasil é intraplaca, então eventos assim são incomuns.`,
    );
  }

  // 10) What Congress just decided — both chambers, when the Senate is present.
  const votes = congress?.votes ?? [];
  const senateVotes = senate?.votes ?? [];
  if (votes.length || senateVotes.length) {
    const all = [...votes, ...senateVotes];
    const approved = all.filter(v => v.approved === true).length;
    const rejected = all.filter(v => v.approved === false).length;
    const where = [
      votes.length ? `${votes.length} na Câmara` : null,
      senateVotes.length ? `${senateVotes.length} no Senado` : null,
    ].filter(Boolean).join(' e ');
    push(
      'info', '🏛️', `${all.length} votações recentes no Congresso`,
      `${where} — ${approved} aprovada(s) · ${rejected} rejeitada(s). Pauta legislativa é o canal mais direto entre política e prêmio de risco nos ativos brasileiros.`,
    );
  }

  // 11) How concentrated national output is. One region carrying more than
  // half the GDP is the structural fact behind most regional-policy debates,
  // and it is why a weather alert over the Sudeste is not economically
  // equivalent to the same alert over the Norte.
  const topRegion = [...(economy?.regions ?? [])].sort((a, b) => b.share - a.share)[0];
  if (topRegion && economy) {
    const smallest = [...economy.regions].sort((a, b) => a.share - b.share)[0];
    push(
      topRegion.share >= 50 ? 'medio' : 'info',
      '🏭', `${topRegion.region} concentra ${topRegion.share.toFixed(1)}% do PIB`,
      `${brl(topRegion.gdp)} de ${brl(economy.totalGdp)} (PIB ${economy.gdpYear ?? '—'}, IBGE).` +
      `${smallest ? ` Na outra ponta, ${smallest.region} responde por ${smallest.share.toFixed(1)}%.` : ''}` +
      ` Choques climáticos ou logísticos pesam no agregado na proporção dessa concentração, não por área atingida.`,
    );
  }

  // 12) Educational spread between states — a slow-moving variable, but the
  // one that bounds how fast the productivity side of any of the above can move.
  if (education?.best?.yearsOfStudy != null && education.worst?.yearsOfStudy != null) {
    const gap = education.best.yearsOfStudy - education.worst.yearsOfStudy;
    push(
      gap >= 3 ? 'medio' : 'info',
      '🎓', `Escolaridade varia ${gap.toFixed(1)} anos entre as UFs`,
      `${education.best.uf} tem ${education.best.yearsOfStudy.toFixed(1)} anos de estudo médios (15+) contra ${education.worst.yearsOfStudy.toFixed(1)} em ${education.worst.uf}` +
      `${education.worst.illiteracyRate != null ? `, onde o analfabetismo é de ${education.worst.illiteracyRate.toFixed(1)}%` : ''}. ` +
      `Média nacional das UFs: ${education.national?.toFixed(1) ?? '—'} anos (PNAD Contínua ${education.year ?? '—'}).`,
    );
  }

  // 13) Unemployment against the real rate: the two numbers that decide
  // whether monetary policy is fighting inflation or fighting the labour market.
  const jobless = finite(unemployment?.value);
  if (jobless != null && selic != null && ipca != null) {
    const real = ((1 + selic / 100) / (1 + ipca / 100) - 1) * 100;
    push(
      jobless >= 9 && real >= 6 ? 'alto' : jobless >= 9 || real >= 8 ? 'medio' : 'info',
      '👷', `Desocupação de ${jobless.toFixed(1)}% com juro real de ${real.toFixed(1)}%`,
      `${unemployment?.date ? `Trimestre ${unemployment.date}. ` : ''}${
        jobless >= 9 && real >= 6
          ? 'Desemprego alto convivendo com juro real restritivo — a política monetária está apertada sobre um mercado de trabalho que já tem folga.'
          : jobless < 7 && real >= 6
            ? 'Mercado de trabalho apertado sustenta o argumento para manter o juro real alto por mais tempo.'
            : 'Combinação dentro da faixa recente; nem o emprego nem o juro real estão no extremo.'
      }`,
    );
  }

  // 14) Dengue alert level across the capitals. InfoDengue's 3 and 4 are the
  // tiers that trigger municipal response, so they are the ones worth a line.
  const dengueHot = dengue.filter(d => d.level >= 3);
  if (dengueHot.length) {
    const red = dengueHot.filter(d => d.level === 4).length;
    push(
      red ? 'alto' : 'medio',
      '🦟', `Dengue em nível ${red ? 'vermelho' : 'laranja'} em ${dengueHot.length} capital(is)`,
      `${dengueHot.slice(0, 4).map(d => `${d.city} (${d.levelLabel}${d.incidence100k != null ? `, ${d.incidence100k}/100mil` : ''})`).join(' · ')}. ` +
      `Escala InfoDengue (Fiocruz/FGV): 3 e 4 indicam transmissão sustentada com incidência acima do esperado para a semana.`,
    );
  }

  // 15) Crisis vocabulary in the state press agencies' own headlines. Using
  // Agência Brasil/Câmara/Senado rather than a commercial aggregator keeps
  // this measuring the official agenda, not an editorial line.
  if (news.length >= 8) {
    const crisis = news.filter(item => CRISIS_KEYWORDS.test(item.title));
    const share = (crisis.length / news.length) * 100;
    if (crisis.length) {
      push(
        share >= 30 ? 'medio' : 'info',
        '📰', `${share.toFixed(0)}% das manchetes oficiais com vocabulário de crise`,
        `${crisis.length} de ${news.length} títulos da Agência Brasil, Agência Câmara e Agência Senado. ` +
        `Ex.: "${crisis[0]!.title.slice(0, 90)}". Palavras rastreadas: crise, greve, enchente, apagão, CPI, operação, colapso e afins.`,
      );
    }
  }

  // 16) Senate bills in motion — the leading edge of the legislative pipeline,
  // ahead of the votes rule above.
  const senateBills = senate?.bills ?? [];
  if (senateBills.length >= 3) {
    const kinds = new Map<string, number>();
    for (const bill of senateBills) kinds.set(bill.kind, (kinds.get(bill.kind) ?? 0) + 1);
    const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    push(
      'info', '📜', `${senateBills.length} matérias movimentadas no Senado`,
      `Predominam ${top.map(([kind, count]) => `${kind} (${count})`).join(', ')}. ` +
      `Ex.: ${senateBills[0]!.code} — ${senateBills[0]!.summary.slice(0, 110)}.`,
    );
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
