// ============================================================================
// Holidays — BrasilAPI's public holiday calendar
// ============================================================================

import { getJson } from '../http.js';
import type { Holiday } from '../types.js';

interface RawHoliday { date: string; name: string; type: string }

export async function fetchUpcomingHolidays(): Promise<Holiday[]> {
  const year = new Date().getUTCFullYear();
  const data = await getJson<RawHoliday[]>(`https://brasilapi.com.br/api/feriados/v1/${year}`, 10_000);
  if (!Array.isArray(data)) return [];

  const today = new Date().toISOString().slice(0, 10);
  return data
    .filter(h => h.date >= today)
    .slice(0, 5)
    .map(h => ({
      date: h.date,
      name: h.name,
      type: h.type,
      daysAway: Math.round((Date.parse(`${h.date}T12:00:00Z`) - Date.now()) / 86_400_000),
    }));
}
