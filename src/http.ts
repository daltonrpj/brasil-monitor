// ============================================================================
// HTTP helper — every sensor fails independently
//
// A composite index built from eight government APIs is only as reliable as
// its worst source. `getJson` never throws: a timeout, a non-200, or bad JSON
// all resolve to `null`, and every sensor function below treats `null` as
// "this source is down right now" rather than crashing the whole snapshot.
// ============================================================================

const USER_AGENT = 'Mozilla/5.0 (compatible; brasil-monitor/1.0; +https://github.com/daltonrpj/brasil-monitor)';

export async function getJson<T = unknown>(
  url: string,
  timeoutMs = 12_000,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getText(url: string, timeoutMs = 12_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Race a promise against a timeout, resolving to `fallback` instead of rejecting. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}
