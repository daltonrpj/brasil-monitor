// ============================================================================
// BrasilMonitor — the facade
//
// Fetches all eight sensors in parallel (each with its own timeout and
// fallback, so one dead API degrades that one section instead of failing the
// whole snapshot), caches the slow-changing sensor data for 5 minutes, and
// recomputes the risk score and cross-signals fresh on every call — those
// depend on market data that moves every minute and must never be served
// stale alongside a merely-5-minutes-old sensor cache.
// ============================================================================

import { crossSignals } from './cross-signals.js';
import { computeRiskScore } from './risk.js';
import { RiskHistoryStore, defaultHistoryDir } from './store.js';
import {
  fetchActiveAlerts, fetchAgenda, fetchCapitalsClimate, fetchCongressRadar, fetchDengueAlerts,
  fetchEarthquakes, fetchEducation, fetchFocusExpectations, fetchHistory, fetchIbgeNews,
  fetchIndicators, fetchOfficialNews, fetchPopulation, fetchRegionalEconomy, fetchSenateRadar,
  fetchTerritoryEvents, fetchTesouroDireto, fetchUnemployment, fetchUpcomingHolidays,
} from './sensors/index.js';
import { regionalBreakdown } from './sensors/weather-alerts.js';
import { withTimeout } from './http.js';
import type { Headline, MarketSnapshot, Snapshot } from './types.js';

export interface BrasilMonitorOptions {
  /** Where the risk-trend history is kept. Defaults to `./.brasil-monitor`. */
  historyDir?: string;
}

export interface SnapshotOptions {
  /** Skip the 5-minute sensor cache and re-fetch everything. */
  force?: boolean;
  /** Today's market moves — optional; the risk score and 3 cross-signals need it, everything else does not. */
  market?: MarketSnapshot;
  /** Today's headlines, for the crisis-keyword component of the risk score. */
  headlines?: Headline[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface SensorBundle {
  alerts: Awaited<ReturnType<typeof fetchActiveAlerts>>;
  ibgeNews: Awaited<ReturnType<typeof fetchIbgeNews>>;
  population: Awaited<ReturnType<typeof fetchPopulation>>;
  tesouro: Awaited<ReturnType<typeof fetchTesouroDireto>>;
  congress: Awaited<ReturnType<typeof fetchCongressRadar>>;
  events: Awaited<ReturnType<typeof fetchTerritoryEvents>>;
  history: Awaited<ReturnType<typeof fetchHistory>>;
  weather: Awaited<ReturnType<typeof fetchCapitalsClimate>>;
  quakes: Awaited<ReturnType<typeof fetchEarthquakes>>;
  holidays: Awaited<ReturnType<typeof fetchUpcomingHolidays>>;
  agenda: Awaited<ReturnType<typeof fetchAgenda>>;
  indicators: Awaited<ReturnType<typeof fetchIndicators>>;
  focus: Awaited<ReturnType<typeof fetchFocusExpectations>>;
  economy: Awaited<ReturnType<typeof fetchRegionalEconomy>>;
  education: Awaited<ReturnType<typeof fetchEducation>>;
  unemployment: Awaited<ReturnType<typeof fetchUnemployment>>;
  news: Awaited<ReturnType<typeof fetchOfficialNews>>;
  senate: Awaited<ReturnType<typeof fetchSenateRadar>>;
  dengue: Awaited<ReturnType<typeof fetchDengueAlerts>>;
}

const EMPTY_ECONOMY = { states: [], regions: [], gdpYear: null, populationYear: null, totalGdp: 0 };
const EMPTY_EDUCATION = { states: [], regions: [], year: null, national: null, best: null, worst: null };

export class BrasilMonitor {
  private readonly history: RiskHistoryStore;
  private cache: { at: number; sensors: SensorBundle } | null = null;

  constructor(options: BrasilMonitorOptions = {}) {
    this.history = new RiskHistoryStore(options.historyDir ?? defaultHistoryDir());
  }

  async snapshot(options: SnapshotOptions = {}): Promise<Snapshot> {
    const sensors = await this.sensorBundle(options.force ?? false);
    const market = options.market ?? {};
    const headlines = options.headlines ?? [];

    const regional = regionalBreakdown(sensors.alerts);

    // Headlines the caller passes take precedence; otherwise the three state
    // press agencies fill the news component on their own.
    const newsHeadlines = headlines.length ? headlines : sensors.news.map(item => ({ title: item.title }));

    const risk = computeRiskScore({
      alerts: sensors.alerts, events: sensors.events,
      dolarChangePct: market.dolarChangePct, ibovChangePct: market.ibovChangePct,
      headlines: newsHeadlines, dengue: sensors.dengue,
    });
    try { this.history.save(risk.score); } catch { /* history is best-effort */ }

    const cross = crossSignals({
      alerts: sensors.alerts, events: sensors.events, regional, weather: sensors.weather,
      indicators: sensors.indicators, focus: sensors.focus, market,
      tesouro: sensors.tesouro, quakes: sensors.quakes, congress: sensors.congress,
      economy: sensors.economy, education: sensors.education, unemployment: sensors.unemployment,
      news: sensors.news, senate: sensors.senate, dengue: sensors.dengue,
    });

    return {
      at: Date.now(),
      alerts: sensors.alerts, regional, events: sensors.events, quakes: sensors.quakes,
      weather: sensors.weather, tesouro: sensors.tesouro, congress: sensors.congress,
      agenda: sensors.agenda, holidays: sensors.holidays, indicators: sensors.indicators,
      focus: sensors.focus, ibgeNews: sensors.ibgeNews, population: sensors.population,
      economy: sensors.economy, education: sensors.education, unemployment: sensors.unemployment,
      news: sensors.news, senate: sensors.senate, dengue: sensors.dengue,
      cross, risk, riskHistory: this.history.history(120),
    };
  }

  private async sensorBundle(force: boolean): Promise<SensorBundle> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.sensors;
    }

    const [
      alerts, ibgeNews, population, tesouro, congress, events, history, weather, quakes, holidays,
      agenda, indicators, focus, economy, education, unemployment, news, senate, dengue,
    ] = await Promise.all([
        withTimeout(fetchActiveAlerts(), 16_000, []),
        withTimeout(fetchIbgeNews(), 14_000, []),
        withTimeout(fetchPopulation(), 12_000, null),
        withTimeout(fetchTesouroDireto(), 45_000, []), // ~14MB CSV, cached 6h internally after the first call
        withTimeout(fetchCongressRadar(), 16_000, { proposals: [], votes: [] }),
        withTimeout(fetchTerritoryEvents(), 16_000, []),
        withTimeout(fetchHistory(), 14_000, { selic: [], ipca: [], dolar: [], cdi: [] }),
        withTimeout(fetchCapitalsClimate(), 16_000, []),
        withTimeout(fetchEarthquakes(), 15_000, []),
        withTimeout(fetchUpcomingHolidays(), 11_000, []),
        withTimeout(fetchAgenda(), 15_000, []),
        withTimeout(fetchIndicators(), 12_000, {
          selic: null, cdi: null, ipca12m: null, ipcaMes: null, igpm: null, dolar: null,
          unemployment: null, debtToGdp: null, reserves: null, ibcbr: null, realRate: null,
        }),
        withTimeout(fetchFocusExpectations(), 12_000, null),
        withTimeout(fetchRegionalEconomy(), 25_000, EMPTY_ECONOMY),
        withTimeout(fetchEducation(), 25_000, EMPTY_EDUCATION),
        withTimeout(fetchUnemployment(), 18_000, null),
        withTimeout(fetchOfficialNews(), 18_000, []),
        withTimeout(fetchSenateRadar(), 24_000, { bills: [], votes: [] }),
        withTimeout(fetchDengueAlerts(), 20_000, []),
      ]);

    const sensors: SensorBundle = {
      alerts, ibgeNews, population, tesouro, congress, events, history,
      weather, quakes, holidays, agenda, indicators, focus,
      economy, education, unemployment, news, senate, dengue,
    };
    this.cache = { at: Date.now(), sensors };
    return sensors;
  }
}
