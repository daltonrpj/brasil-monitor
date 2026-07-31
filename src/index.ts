// ============================================================================
// brasil-monitor — public API
// ============================================================================

export { BrasilMonitor, type BrasilMonitorOptions, type SnapshotOptions } from './monitor.js';
export { serve, createBrasilMonitorServer, type ServeOptions } from './server.js';
export { rewriteManifest, isAllowed, proxyStream, type ProxyOptions } from './stream-proxy.js';
export { crossSignals, CRISIS_KEYWORDS, type CrossSignalInputs } from './cross-signals.js';
export { computeRiskScore, type RiskInputs } from './risk.js';
export { RiskHistoryStore, defaultHistoryDir } from './store.js';
export { STATE_CENTROID, STATE_REGION, STATE_NAME_TO_UF, REGION_ORDER, foldAccents } from './geo.js';

export {
  fetchActiveAlerts, regionalBreakdown,
  fetchIbgeNews, fetchPopulation,
  fetchTesouroDireto, parseTesouroCsv,
  fetchIndicators, fetchHistory, fetchFocusExpectations,
  fetchCongressRadar, fetchAgenda,
  fetchTerritoryEvents, fetchEarthquakes, BRAZIL_BBOX,
  fetchCapitalsClimate, CAPITALS,
  fetchUpcomingHolidays,
  sidra, sidraRows, sidraValue,
  fetchRegionalEconomy, fetchUnemployment,
  fetchEducation,
  fetchOfficialNews, parseRss, tagText, decodeXml,
  fetchSenateRadar,
  fetchDengueAlerts, latestWeek, CAPITAL_GEOCODES, DENGUE_LEVELS,
  fetchBrazilianChannels, resetTvCache, EMPTY_TV_CATALOG,
} from './sensors/index.js';

export * from './types.js';
