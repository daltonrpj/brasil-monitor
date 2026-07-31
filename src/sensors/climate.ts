// ============================================================================
// Climate and air quality across Brazil's 12 largest state capitals
//
// Two requests total (weather + air quality), each multi-point, rather than
// one request per city — Open-Meteo's multi-coordinate endpoint accepts a
// comma-joined list of lat/lon pairs and returns them in the same order.
// ============================================================================

import { getJson } from '../http.js';
import type { CapitalWeather } from '../types.js';

export const CAPITALS: Array<[city: string, uf: string, lat: number, lon: number]> = [
  ['São Paulo', 'SP', -23.55, -46.63], ['Rio de Janeiro', 'RJ', -22.91, -43.17], ['Brasília', 'DF', -15.78, -47.93],
  ['Salvador', 'BA', -12.97, -38.5], ['Belo Horizonte', 'MG', -19.92, -43.94], ['Porto Alegre', 'RS', -30.03, -51.23],
  ['Recife', 'PE', -8.05, -34.88], ['Manaus', 'AM', -3.12, -60.02], ['Curitiba', 'PR', -25.43, -49.27],
  ['Fortaleza', 'CE', -3.73, -38.52], ['Belém', 'PA', -1.46, -48.5], ['Goiânia', 'GO', -16.68, -49.25],
];

function weatherCodeToLabel(code: number): [emoji: string, description: string] {
  if (code === 0) return ['☀️', 'Céu limpo'];
  if (code <= 3) return ['⛅', 'Nuvens'];
  if (code <= 48) return ['🌫️', 'Névoa'];
  if (code <= 67) return ['🌧️', 'Chuva'];
  if (code <= 77) return ['🌨️', 'Neve'];
  if (code <= 82) return ['🌦️', 'Pancadas'];
  if (code <= 99) return ['⛈️', 'Tempestade'];
  return ['🌡️', '—'];
}

/** European AQI scale: <20 great, <40 good, <60 moderate, <80 poor, <100 very poor, else hazardous. */
function aqiToLabel(value: number | null): [label: string, color: string] | null {
  if (value == null) return null;
  if (value < 20) return ['Ótimo', '#34d399'];
  if (value < 40) return ['Bom', '#a3e635'];
  if (value < 60) return ['Moderado', '#fbbf24'];
  if (value < 80) return ['Ruim', '#fb923c'];
  if (value < 100) return ['Muito ruim', '#ef4444'];
  return ['Péssimo', '#a855f7'];
}

interface OpenMeteoWeatherResponse {
  current?: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number };
  daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
}
interface OpenMeteoAirQualityResponse {
  current?: { european_aqi: number; pm2_5: number };
}

export async function fetchCapitalsClimate(): Promise<CapitalWeather[]> {
  const lats = CAPITALS.map(c => c[2]).join(',');
  const lons = CAPITALS.map(c => c[3]).join(',');

  const [weatherResponse, airResponse] = await Promise.all([
    getJson<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&forecast_days=3&timezone=America%2FSao_Paulo`, 14_000,
    ),
    getJson<OpenMeteoAirQualityResponse | OpenMeteoAirQualityResponse[]>(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}` +
      `&current=european_aqi,pm2_5&timezone=America%2FSao_Paulo`, 14_000,
    ),
  ]);

  const weatherList = Array.isArray(weatherResponse) ? weatherResponse : weatherResponse ? [weatherResponse] : [];
  const airList = Array.isArray(airResponse) ? airResponse : airResponse ? [airResponse] : [];

  return CAPITALS.map(([city, uf], i): CapitalWeather | null => {
    const current = weatherList[i]?.current;
    if (!current) return null;

    const [emoji, description] = weatherCodeToLabel(current.weather_code);
    const daily = weatherList[i]?.daily;
    const aqi = airList[i]?.current?.european_aqi ?? null;
    const aqiInfo = aqiToLabel(aqi);

    return {
      city, uf,
      temp: Math.round(current.temperature_2m), emoji, description,
      humidity: current.relative_humidity_2m ?? null,
      windKmh: current.wind_speed_10m != null ? Math.round(current.wind_speed_10m) : null,
      max: daily?.temperature_2m_max?.[0] != null ? Math.round(daily.temperature_2m_max[0]!) : null,
      min: daily?.temperature_2m_min?.[0] != null ? Math.round(daily.temperature_2m_min[0]!) : null,
      rainChance: daily?.precipitation_probability_max?.[0] ?? null,
      forecast: (daily?.time ?? []).slice(0, 3).map((day, k) => ({
        day,
        max: Math.round(daily?.temperature_2m_max?.[k] ?? 0),
        min: Math.round(daily?.temperature_2m_min?.[k] ?? 0),
        rainChance: daily?.precipitation_probability_max?.[k] ?? null,
      })),
      aqi, aqiLabel: aqiInfo?.[0] ?? null, aqiColor: aqiInfo?.[1] ?? null,
      pm25: airList[i]?.current?.pm2_5 ?? null,
    };
  }).filter((entry): entry is CapitalWeather => entry !== null);
}
