// ============================================================================
// HTTP server — the dashboard and its one API endpoint
//
// Node's own http module, no framework. Binds to 127.0.0.1 by default: there
// is nothing here that needs to be reachable off the machine.
// ============================================================================

import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrasilMonitor } from './monitor.js';
import type { MarketSnapshot } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Supply market data on every request — see examples/with-market.mjs. */
  market?: () => MarketSnapshot | Promise<MarketSnapshot>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export function createBrasilMonitorServer(monitor: BrasilMonitor, options: ServeOptions = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await readFile(join(__dirname, '..', 'public', 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        const market = options.market ? await options.market() : undefined;
        const snapshot = await monitor.snapshot({ force: url.searchParams.get('force') === '1', market });
        return json(res, 200, snapshot);
      }

      json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function serve(monitor: BrasilMonitor, options: ServeOptions = {}): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4320;
  const server = createBrasilMonitorServer(monitor, options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve({ port, host, close: () => new Promise<void>(done => server.close(() => done())) });
    });
  });
}
