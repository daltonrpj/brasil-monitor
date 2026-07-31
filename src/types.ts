// ============================================================================
// Shared types
// ============================================================================

export type Severity = 'amarelo' | 'laranja' | 'vermelho';
export type Region = 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul';

/** Two-letter Brazilian state code, e.g. "SP", "RJ". */
export type UF = string;

export interface WeatherAlert {
  event: string;
  severity: Severity;
  ufs: UF[];
  risks: string;
  start: string | null;
  end: string | null;
  url: string;
}

export interface RegionalBreakdown {
  region: Region;
  count: number;
  worst: Severity | null;
}

export interface TerritoryEvent {
  source: 'EONET' | 'GDACS';
  type: string;
  title: string;
  /** EONET: 'orange' | 'green'. GDACS: its own alert level, lowercased. */
  severity: string;
  lat: number;
  lon: number;
  date: string | null;
  url: string | null;
}

export interface Earthquake {
  mag: number | undefined;
  place: string;
  time: number | null;
  lat: number;
  lon: number;
  url: string | null;
}

export interface CapitalWeather {
  city: string;
  uf: UF;
  temp: number;
  emoji: string;
  description: string;
  humidity: number | null;
  windKmh: number | null;
  max: number | null;
  min: number | null;
  rainChance: number | null;
  forecast: Array<{ day: string; max: number; min: number; rainChance: number | null }>;
  aqi: number | null;
  aqiLabel: string | null;
  aqiColor: string | null;
  pm25: number | null;
}

export interface TesouroTitle {
  name: string;
  /** ISO date (yyyy-mm-dd). */
  maturity: string;
  buyRate: number | null;
  sellRate: number | null;
  buyPrice: number | null;
}

export interface CongressProposal {
  id: number;
  code: string;
  summary: string;
  url: string;
}

export interface CongressVote {
  id: number | string;
  date: string | null;
  /** The bill the vote decided, when it had one. */
  subject: string;
  description: string;
  body: string;
  approved: boolean | null;
  url: string;
}

export interface CongressRadar {
  proposals: CongressProposal[];
  votes: CongressVote[];
}

export interface AgendaItem {
  id: number;
  start: string | null;
  description: string;
  type: string;
  place: string;
  status: string;
  url: string;
}

export interface Holiday {
  date: string;
  name: string;
  type: string;
  daysAway: number;
}

export interface Indicator {
  label: string;
  value: number;
  unit: string;
  date: string;
}

export interface BcbIndicators {
  selic: Indicator | null;
  cdi: Indicator | null;
  ipca12m: Indicator | null;
  ipcaMes: Indicator | null;
  igpm: Indicator | null;
  dolar: Indicator | null;
  unemployment: Indicator | null;
  debtToGdp: Indicator | null;
  reserves: Indicator | null;
  ibcbr: Indicator | null;
  /** Ex-post real rate: Selic compounded against 12-month IPCA. */
  realRate: Indicator | null;
}

export interface FocusExpectations {
  year: number;
  ipca: number | null;
  selic: number | null;
  gdp: number | null;
  fx: number | null;
  date: string | null;
}

export interface BcbHistory {
  selic: number[];
  ipca: number[];
  dolar: number[];
  cdi: number[];
}

export interface StateGdp {
  uf: UF;
  name: string;
  region: Region;
  /** In BRL. SIDRA publishes thousands; this is already multiplied out. */
  gdp: number;
  population: number | null;
  gdpPerCapita: number | null;
}

export interface RegionEconomy {
  region: Region;
  gdp: number;
  /** Percentage of national GDP. */
  share: number;
  population: number | null;
  gdpPerCapita: number | null;
  states: number;
}

export interface RegionalEconomy {
  states: StateGdp[];
  regions: RegionEconomy[];
  gdpYear: string | null;
  populationYear: string | null;
  totalGdp: number;
}

export interface StateEducation {
  uf: UF;
  region: Region;
  /** Mean years of schooling, 15+ years old. */
  yearsOfStudy: number | null;
  illiteracyRate: number | null;
}

export interface RegionEducation {
  region: Region;
  yearsOfStudy: number | null;
  illiteracyRate: number | null;
  states: number;
}

export interface EducationSnapshot {
  states: StateEducation[];
  regions: RegionEducation[];
  year: string | null;
  national: number | null;
  best: StateEducation | null;
  worst: StateEducation | null;
}

export type NewsSource = 'Agência Brasil' | 'Câmara' | 'Senado';

export interface NewsItem {
  source: NewsSource;
  agency: string;
  title: string;
  link: string;
  date: string | null;
  summary: string;
}

export interface SenateBill {
  code: string;
  year: number;
  kind: string;
  house: string;
  summary: string;
  url: string;
}

export interface SenateVote {
  date: string | null;
  subject: string;
  description: string;
  approved: boolean | null;
  secret: boolean;
  url: string;
}

export interface SenateRadar {
  bills: SenateBill[];
  votes: SenateVote[];
}

export interface DengueAlert {
  city: string;
  uf: UF;
  geocode: number;
  /** InfoDengue's 1-4 scale: green, yellow, orange, red. */
  level: number;
  levelLabel: string;
  color: string;
  cases: number;
  estimatedCases: number;
  incidence100k: number | null;
  rt: number | null;
  /** Epidemiological week, e.g. 202629. */
  week: number | null;
}

/** One deterministic reading from crossing two or more data layers. */
export interface CrossSignal {
  level: 'alto' | 'medio' | 'info';
  icon: string;
  title: string;
  detail: string;
}

export interface RiskComponent {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface RiskScore {
  score: number;
  level: 'baixo' | 'moderado' | 'elevado' | 'crítico';
  parts: RiskComponent[];
  at: number;
}

export interface RiskHistoryPoint {
  at: number;
  score: number;
}

/**
 * Market moves the caller supplies for risk/cross-signal calculation. This
 * package does not fetch quotes itself — plug in whatever source you already
 * have (Yahoo Finance, Binance, a broker feed, or the bundled example client).
 */
export interface MarketSnapshot {
  dolarChangePct?: number | null;
  ibovChangePct?: number | null;
  soybeanChangePct?: number | null;
  cornChangePct?: number | null;
}

/** A single headline, for the crisis-keyword scan the risk score reads. */
export interface Headline {
  title: string;
}

export interface Snapshot {
  at: number;
  alerts: WeatherAlert[];
  regional: RegionalBreakdown[];
  events: TerritoryEvent[];
  quakes: Earthquake[];
  weather: CapitalWeather[];
  tesouro: TesouroTitle[];
  congress: CongressRadar;
  agenda: AgendaItem[];
  holidays: Holiday[];
  indicators: BcbIndicators;
  focus: FocusExpectations | null;
  ibgeNews: Array<{ title: string; intro: string; date: string | null; link: string; type: string }>;
  population: { total: number; horizon: string | null } | null;
  economy: RegionalEconomy;
  education: EducationSnapshot;
  unemployment: Indicator | null;
  news: NewsItem[];
  senate: SenateRadar;
  dengue: DengueAlert[];
  cross: CrossSignal[];
  risk: RiskScore;
  riskHistory: RiskHistoryPoint[];
}
