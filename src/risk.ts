// ============================================================================
// Brazil Risk Index (0-100) — climate, territory, currency, equities, news
// and public health
//
// A weighted average of independently-capped components. None of them alone
// can push the score past its 1/N share of the total, so no single noisy
// source (one bad wildfire day, one volatile trading session) can spike the
// whole index — it takes several layers agreeing for the score to move a lot,
// which is the point of a *composite* index.
//
// The first five components — clima, ambiental, cambial, bolsa, notícias —
// carry the exact formulas and thresholds of the private system this was
// extracted from. The sixth, saúde, is an addition: it only appears when
// dengue data is supplied, so a caller that passes nothing gets byte-identical
// scores to the original five-component index.
// ============================================================================

import type { DengueAlert, Headline, RiskComponent, RiskScore, TerritoryEvent, WeatherAlert } from './types.js';

export interface RiskInputs {
  alerts?: WeatherAlert[];
  events?: TerritoryEvent[];
  dolarChangePct?: number | null;
  ibovChangePct?: number | null;
  headlines?: Headline[];
  dengue?: DengueAlert[];
}

const CRISIS_KEYWORDS = /crise|escândalo|CPI|impeachment|greve|apagão|enchente|tragédia|operação|queda|colapso/i;

export function computeRiskScore(inputs: RiskInputs = {}): RiskScore {
  const { alerts = [], events = [], dolarChangePct = null, ibovChangePct = null, headlines = [], dengue = [] } = inputs;
  const parts: RiskComponent[] = [];

  // Weather: red alerts weigh 15x a plain alert count, orange 5x.
  const redAlerts = alerts.filter(a => a.severity === 'vermelho').length;
  const orangeAlerts = alerts.filter(a => a.severity === 'laranja').length;
  const climate = Math.min(100, redAlerts * 30 + orangeAlerts * 10 + alerts.length * 2);
  parts.push({
    key: 'clima', label: 'Alertas INMET ativos', score: climate,
    detail: `${redAlerts} vermelhos · ${orangeAlerts} laranjas · ${alerts.length} total`,
  });

  // Territory: wildfires/disasters, weighted by EONET/GDACS severity.
  const redEvents = events.filter(e => e.severity === 'red').length;
  const orangeEvents = events.filter(e => e.severity === 'orange').length;
  const territory = Math.min(100, redEvents * 25 + orangeEvents * 6);
  parts.push({
    key: 'ambiental', label: 'Queimadas/eventos de alto impacto', score: territory,
    detail: `${redEvents} vermelhos · ${orangeEvents} laranjas · ${events.length} total`,
  });

  // FX pressure: only the dollar RISING counts as stress (a falling dollar
  // is not currency risk), scaled so +2.2% alone maxes this component out.
  if (Number.isFinite(dolarChangePct)) {
    const fxStress = Math.min(100, Math.max(0, dolarChangePct as number) * 45);
    parts.push({
      key: 'cambial', label: 'Pressão cambial (dólar hoje)', score: Math.round(fxStress),
      detail: `${(dolarChangePct as number) > 0 ? '+' : ''}${dolarChangePct}%`,
    });
  }

  // Equity stress: only the index FALLING counts, scaled so -2.5% maxes it out.
  if (Number.isFinite(ibovChangePct)) {
    const equityStress = Math.min(100, Math.max(0, -(ibovChangePct as number)) * 40);
    parts.push({
      key: 'bolsa', label: 'Estresse na B3 (Ibovespa hoje)', score: Math.round(equityStress),
      detail: `${(ibovChangePct as number) > 0 ? '+' : ''}${ibovChangePct}%`,
    });
  }

  // News flow: share of today's headlines matching a crisis-keyword list.
  const crisisCount = headlines.filter(h => CRISIS_KEYWORDS.test(h.title || '')).length;
  const totalHeadlines = headlines.length || 1;
  parts.push({
    key: 'noticias', label: 'Fluxo de crise nas manchetes',
    score: Math.min(100, Math.round((crisisCount / totalHeadlines) * 300)),
    detail: `${crisisCount}/${totalHeadlines} manchetes`,
  });

  // Public health: InfoDengue's red tier weighs 4x its orange tier, scaled so
  // three simultaneous red capitals max the component out. Only added when the
  // caller supplies dengue data — see the note at the top of the file.
  if (dengue.length) {
    const red = dengue.filter(d => d.level === 4).length;
    const orange = dengue.filter(d => d.level === 3).length;
    parts.push({
      key: 'saude', label: 'Alerta de dengue nas capitais',
      score: Math.min(100, red * 34 + orange * 8),
      detail: `${red} vermelhos · ${orange} laranjas · ${dengue.length} capitais`,
    });
  }

  const score = Math.round(parts.reduce((sum, part) => sum + part.score, 0) / parts.length);
  const level = score >= 60 ? 'crítico' : score >= 40 ? 'elevado' : score >= 22 ? 'moderado' : 'baixo';

  return { score, level, parts, at: Date.now() };
}
