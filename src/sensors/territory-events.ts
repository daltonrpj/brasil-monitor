// ============================================================================
// Territory events — wildfires/disasters (NASA EONET, GDACS) and earthquakes
// (USGS), filtered to a Brazil bounding box
// ============================================================================

import { getJson } from '../http.js';
import type { Earthquake, TerritoryEvent } from '../types.js';

export const BRAZIL_BBOX = { minLat: -34.5, maxLat: 5.5, minLon: -74.5, maxLon: -34.0 };

function isInBrazil(lat: number, lon: number): boolean {
  return lat >= BRAZIL_BBOX.minLat && lat <= BRAZIL_BBOX.maxLat &&
    lon >= BRAZIL_BBOX.minLon && lon <= BRAZIL_BBOX.maxLon;
}

/**
 * EONET tracks even small, routine fires by the thousand — only categories
 * with real macro impact count toward the "orange" tier the risk engine reads.
 */
const HIGH_IMPACT_CATEGORIES = /Severe Storms|Volcanoes|Floods|Landslides|Temperature Extremes/i;

interface EonetEvent {
  title: string;
  categories?: Array<{ title: string }>;
  geometry?: Array<{ coordinates?: [number, number]; date?: string }>;
  sources?: Array<{ url?: string }>;
}

interface GdacsFeature {
  properties?: { eventtype?: string; name?: string; eventname?: string; alertlevel?: string; fromdate?: string; country?: string; eventid?: string };
  geometry?: { coordinates?: [number, number] };
}

export async function fetchTerritoryEvents(): Promise<TerritoryEvent[]> {
  const out: TerritoryEvent[] = [];

  const bbox = `${BRAZIL_BBOX.minLon},${BRAZIL_BBOX.maxLat},${BRAZIL_BBOX.maxLon},${BRAZIL_BBOX.minLat}`;
  const eonet = await getJson<{ events?: EonetEvent[] }>(
    `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60&bbox=${bbox}`, 14_000,
  );
  for (const event of eonet?.events ?? []) {
    const geometry = event.geometry?.at(-1);
    const [lon, lat] = geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isInBrazil(lat, lon)) continue;

    const category = event.categories?.[0]?.title ?? 'Evento';
    out.push({
      source: 'EONET', type: category, title: event.title,
      severity: HIGH_IMPACT_CATEGORIES.test(category) ? 'orange' : 'green',
      lat, lon, date: geometry?.date ?? null, url: event.sources?.[0]?.url ?? null,
    });
  }

  const gdacs = await getJson<{ features?: GdacsFeature[] }>(
    'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP', 14_000,
  );
  for (const feature of gdacs?.features ?? []) {
    const props = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isInBrazil(lat, lon)) continue;
    if (props.country && !/brazil|brasil/i.test(props.country)) continue;

    out.push({
      source: 'GDACS', type: props.eventtype ?? 'Evento', title: props.name || props.eventname || 'Evento',
      severity: (props.alertlevel ?? 'orange').toLowerCase(), lat, lon, date: props.fromdate ?? null,
      url: props.eventid ? `https://www.gdacs.org/report.aspx?eventid=${props.eventid}&eventtype=${props.eventtype}` : null,
    });
  }

  return out.slice(0, 60);
}

interface UsgsFeature {
  properties?: { mag?: number; place?: string; time?: number; url?: string };
  geometry?: { coordinates?: [number, number] };
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}` +
    `&minlatitude=${BRAZIL_BBOX.minLat}&maxlatitude=${BRAZIL_BBOX.maxLat}` +
    `&minlongitude=${BRAZIL_BBOX.minLon}&maxlongitude=${BRAZIL_BBOX.maxLon}` +
    `&minmagnitude=2.5&orderby=time&limit=40`;

  const data = await getJson<{ features?: UsgsFeature[] }>(url, 14_000);
  const quakes: Earthquake[] = [];
  for (const feature of data?.features ?? []) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    quakes.push({
      mag: feature.properties?.mag, place: feature.properties?.place ?? '',
      time: feature.properties?.time ?? null, lat, lon, url: feature.properties?.url ?? null,
    });
  }
  return quakes;
}
