// ============================================================================
// SIDRA — IBGE's statistical aggregate API
//
// SIDRA returns an array whose FIRST row is a header dictionary mapping column
// codes to human labels, and whose remaining rows are the actual observations.
// Missing observations come back as the string ".." (or "-"), never as null,
// so every read here has to reject those explicitly rather than trusting
// Number() — `Number('..')` is NaN, but `Number('-')` is also NaN and
// `Number('')` is 0, which would silently become a real-looking zero.
// ============================================================================

import { getJson } from '../http.js';

export type SidraRow = Record<string, string>;

/** Drop SIDRA's header row and anything that is not an observation. */
export function sidraRows(payload: unknown): SidraRow[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  return payload.slice(1).filter((row): row is SidraRow => !!row && typeof row === 'object');
}

/** SIDRA marks "no data" with ".." or "-" — both must read as null, not 0. */
export function sidraValue(row: SidraRow): number | null {
  const raw = (row.V ?? '').trim();
  if (!raw || raw === '..' || raw === '-' || raw === '...') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// SIDRA answers every one of these queries on its own, but starts returning
// empty when five of them arrive at once alongside the rest of the snapshot's
// two dozen parallel requests. Rather than let three sensors silently blank
// out under load, requests to this one host are queued through a single chain
// and retried once.
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sidra(path: string, timeoutMs = 20_000): Promise<SidraRow[]> {
  const url = `https://apisidra.ibge.gov.br/values/${path}`;

  const run = queue.then(async () => {
    const first = sidraRows(await getJson<unknown>(url, timeoutMs));
    if (first.length) return first;
    await sleep(600);
    return sidraRows(await getJson<unknown>(url, timeoutMs));
  });

  queue = run.catch(() => undefined); // a failed request must not poison the chain
  return run;
}
