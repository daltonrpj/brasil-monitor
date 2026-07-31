// ============================================================================
// HLS proxy
//
// Browsers refuse to play most of these streams directly: the CDNs do not send
// Access-Control-Allow-Origin, so hls.js cannot read the manifest. The proxy
// fetches upstream server-side, rewrites every URI inside the manifest to come
// back through here, and adds the CORS header the CDN omitted.
//
// It is an ALLOWLIST proxy. The only hosts it will contact are the ones that
// appear in the loaded iptv-org catalog. A proxy that forwards to any URL a
// caller supplies is an SSRF hole — it would happily fetch a cloud metadata
// endpoint or something on the operator's private network, and this server is
// meant to be safe to expose.
// ============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

const MANIFEST = /\.m3u8(\?|$)|mpegurl/i;
const ABSOLUTE = /^https?:\/\//i;

/**
 * Rewrite every URI in an HLS manifest to route back through the proxy —
 * segments, nested variant playlists, encryption keys and init maps alike.
 * Relative URIs resolve against the manifest's own (post-redirect) URL.
 */
export function rewriteManifest(text: string, manifestUrl: string, proxyPath: string): string {
  const base = new URL(manifestUrl);
  const absolute = (uri: string): string => (ABSOLUTE.test(uri) ? uri : new URL(uri, base).toString());
  const wrap = (uri: string): string => `${proxyPath}?url=${encodeURIComponent(absolute(uri))}`;

  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    // Tag lines carry their URIs in a URI="..." attribute; everything else that
    // is not a comment is a segment or variant playlist on its own line.
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${wrap(uri)}"`);
    return wrap(trimmed);
  }).join('\n');
}

export interface ProxyOptions {
  /** Hosts the proxy is allowed to contact — lowercase, no port. */
  allowedHosts: Set<string>;
  proxyPath?: string;
  timeoutMs?: number;
}

export function isAllowed(rawUrl: string, allowedHosts: Set<string>): boolean {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return allowedHosts.has(url.host.toLowerCase());
}

export async function proxyStream(
  rawUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  options: ProxyOptions,
): Promise<void> {
  const { allowedHosts, proxyPath = '/api/tv/stream', timeoutMs = 20_000 } = options;

  if (!isAllowed(rawUrl, allowedHosts)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Host not in the iptv-org catalog');
    return;
  }

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; brasil-monitor)',
    Accept: '*/*',
  };
  // Seeking and buffering both depend on Range surviving the hop.
  if (typeof req.headers.range === 'string') headers.Range = req.headers.range;

  // The timeout bounds how long we wait for response HEADERS, and is cleared
  // once they arrive. AbortSignal.timeout() would keep running and abort the
  // body mid-transfer, which for a live stream is guaranteed to happen.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // If the viewer navigates away, stop pulling from the CDN.
  const onClientGone = (): void => controller.abort();
  res.on('close', onClientGone);

  let upstream: Response;
  try {
    upstream = await fetch(rawUrl, { headers, redirect: 'follow', signal: controller.signal });
  } catch {
    clearTimeout(timer);
    res.off('close', onClientGone);
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Upstream não respondeu');
    }
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok && upstream.status !== 206) {
    res.off('close', onClientGone);
    res.writeHead(upstream.status, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  if (MANIFEST.test(contentType) || MANIFEST.test(rawUrl)) {
    let text: string;
    try {
      text = await upstream.text();
    } catch {
      res.off('close', onClientGone);
      if (!res.headersSent) { res.writeHead(502, cors); res.end(); }
      return;
    }
    res.off('close', onClientGone);
    const body = rewriteManifest(text, upstream.url || rawUrl, proxyPath);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  // Segments are piped rather than buffered: a single .ts segment is a few
  // megabytes and a dozen viewers buffering them all in memory adds up fast.
  const passthrough: Record<string, string> = { ...cors, 'Content-Type': contentType || 'video/mp2t' };
  for (const header of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) passthrough[header] = value;
  }

  res.writeHead(upstream.status, passthrough);
  if (!upstream.body) { res.off('close', onClientGone); res.end(); return; }

  const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  // A stalled CDN, an abort, or a viewer closing the tab all surface as an
  // 'error' on this stream. Without a listener, Node treats it as an unhandled
  // error event and takes the whole process down — a dead segment must cost
  // one request, not the server.
  body.on('error', () => { if (!res.writableEnded) res.end(); });
  res.on('error', () => body.destroy());
  res.on('close', () => body.destroy());
  body.pipe(res);
}
