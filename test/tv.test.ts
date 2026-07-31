import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBrazilianChannels, resetTvCache } from '../src/sensors/iptv.js';
import { rewriteManifest, isAllowed } from '../src/stream-proxy.js';

const realFetch = globalThis.fetch;

interface Fixture { channels?: unknown; streams?: unknown; logos?: unknown }
function mockApi(fixture: Fixture) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = url.includes('channels') ? 'channels' : url.includes('streams') ? 'streams' : 'logos';
    return new Response(JSON.stringify(fixture[key as keyof Fixture] ?? []), { status: 200 });
  }) as typeof fetch;
}

const channel = (over: Record<string, unknown> = {}) => ({
  id: 'X.br', name: 'Canal X', country: 'BR', categories: ['general'], ...over,
});
const stream = (over: Record<string, unknown> = {}) => ({
  channel: 'X.br', url: 'https://cdn.example.com/x/index.m3u8', quality: '720p', ...over,
});

beforeEach(() => { resetTvCache(); });
afterEach(() => { globalThis.fetch = realFetch; resetTvCache(); });

describe('fetchBrazilianChannels', () => {
  it('keeps only Brazilian channels that actually have a stream', async () => {
    mockApi({
      channels: [
        channel(),
        channel({ id: 'AR.ar', name: 'Canal AR', country: 'AR' }),
        channel({ id: 'NoStream.br', name: 'Sem Stream' }),
      ],
      streams: [stream(), stream({ channel: 'AR.ar' })],
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.channels.map(c => c.id), ['X.br']);
  });

  it('drops closed, replaced and NSFW channels', async () => {
    mockApi({
      channels: [
        channel({ id: 'A.br', closed: '2020-01-01' }),
        channel({ id: 'B.br', replaced_by: 'C.br' }),
        channel({ id: 'C.br', is_nsfw: true }),
        channel({ id: 'D.br', name: 'Vivo' }),
      ],
      streams: ['A.br', 'B.br', 'C.br', 'D.br'].map(id => stream({ channel: id })),
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.channels.map(c => c.id), ['D.br']);
  });

  it('orders streams best-quality first and keeps at most four', async () => {
    mockApi({
      channels: [channel()],
      streams: [
        stream({ url: 'https://cdn.example.com/1.m3u8', quality: '480p' }),
        stream({ url: 'https://cdn.example.com/2.m3u8', quality: '1080p' }),
        stream({ url: 'https://cdn.example.com/3.m3u8', quality: '720p' }),
        stream({ url: 'https://cdn.example.com/4.m3u8', quality: '2160p' }),
        stream({ url: 'https://cdn.example.com/5.m3u8', quality: '576p' }),
      ],
    });
    const catalog = await fetchBrazilianChannels();
    const streams = catalog.channels[0]!.streams;
    assert.equal(streams.length, 4);
    assert.deepEqual(streams.map(s => s.quality), ['2160p', '1080p', '720p', '576p']);
  });

  it('flags part-time channels from the iptv-org label', async () => {
    mockApi({
      channels: [channel()],
      streams: [stream({ label: 'Not 24/7' })],
    });
    const catalog = await fetchBrazilianChannels();
    assert.equal(catalog.channels[0]!.streams[0]!.partTime, true);
  });

  it('rejects stream URLs that are not http(s)', async () => {
    mockApi({
      channels: [channel(), channel({ id: 'Y.br', name: 'Canal Y' })],
      streams: [stream({ url: 'rtmp://cdn.example.com/live' }), stream({ channel: 'Y.br' })],
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.channels.map(c => c.id), ['Y.br']);
  });

  it('maps iptv-org categories onto the dashboard groups', async () => {
    mockApi({
      channels: [
        channel({ id: 'N.br', name: 'N', categories: ['news'] }),
        channel({ id: 'L.br', name: 'L', categories: ['legislative'] }),
        channel({ id: 'S.br', name: 'S', categories: ['sports'] }),
        channel({ id: 'C.br', name: 'C', categories: ['documentary'] }),
        channel({ id: 'G.br', name: 'G', categories: ['movies'] }),
        channel({ id: 'E.br', name: 'E', categories: [] }),
      ],
      streams: ['N.br', 'L.br', 'S.br', 'C.br', 'G.br', 'E.br'].map(id => stream({ channel: id })),
    });
    const catalog = await fetchBrazilianChannels();
    const groupOf = (id: string) => catalog.channels.find(c => c.id === id)!.group;
    assert.equal(groupOf('N.br'), 'Jornalismo');
    assert.equal(groupOf('L.br'), 'Institucional');
    assert.equal(groupOf('S.br'), 'Esportes');
    assert.equal(groupOf('C.br'), 'Cultura');
    assert.equal(groupOf('G.br'), 'Geral');   // movies is not one of the four
    assert.equal(groupOf('E.br'), 'Geral');   // no categories at all
  });

  it('counts each group and sorts the counts descending', async () => {
    mockApi({
      channels: [
        channel({ id: 'N1.br', name: 'N1', categories: ['news'] }),
        channel({ id: 'N2.br', name: 'N2', categories: ['news'] }),
        channel({ id: 'S1.br', name: 'S1', categories: ['sports'] }),
      ],
      streams: ['N1.br', 'N2.br', 'S1.br'].map(id => stream({ channel: id })),
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.groups, [{ group: 'Jornalismo', count: 2 }, { group: 'Esportes', count: 1 }]);
  });

  it('picks the largest logo per channel', async () => {
    mockApi({
      channels: [channel()],
      streams: [stream()],
      logos: [
        { channel: 'X.br', url: 'https://img/small.png', width: 100, height: 100 },
        { channel: 'X.br', url: 'https://img/big.png', width: 512, height: 512 },
      ],
    });
    const catalog = await fetchBrazilianChannels();
    assert.equal(catalog.channels[0]!.logo, 'https://img/big.png');
  });

  it('collects every stream host as the proxy allowlist', async () => {
    mockApi({
      channels: [channel(), channel({ id: 'Y.br', name: 'Y' })],
      streams: [
        stream({ url: 'https://ONE.example.com/a.m3u8' }),
        stream({ channel: 'Y.br', url: 'https://two.example.com:8080/b.m3u8' }),
      ],
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.hosts, ['one.example.com', 'two.example.com:8080']);
  });

  it('sorts channels by name using Brazilian collation', async () => {
    mockApi({
      channels: [
        channel({ id: 'Z.br', name: 'Zebra' }),
        channel({ id: 'A.br', name: 'Áurea' }),
        channel({ id: 'B.br', name: 'Banda' }),
      ],
      streams: ['Z.br', 'A.br', 'B.br'].map(id => stream({ channel: id })),
    });
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.channels.map(c => c.name), ['Áurea', 'Banda', 'Zebra']);
  });

  it('serves the second call from cache without refetching', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls++;
      const url = String(input);
      const body = url.includes('channels') ? [channel()] : url.includes('streams') ? [stream()] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    await fetchBrazilianChannels();
    assert.equal(calls, 3);
    await fetchBrazilianChannels();
    assert.equal(calls, 3, 'second call should have hit the cache');
    await fetchBrazilianChannels({ force: true });
    assert.equal(calls, 6);
  });

  it('does not cache an empty result, so a bad day is retried', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('[]', { status: 200 }); }) as typeof fetch;
    await fetchBrazilianChannels();
    await fetchBrazilianChannels();
    assert.equal(calls, 6);
  });

  it('returns an empty catalog when iptv-org is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    const catalog = await fetchBrazilianChannels();
    assert.deepEqual(catalog.channels, []);
  });
});

describe('rewriteManifest', () => {
  const PROXY = '/api/tv/stream';
  const BASE = 'https://cdn.example.com/live/index.m3u8';

  it('routes relative segment lines back through the proxy', () => {
    const out = rewriteManifest('#EXTM3U\n#EXTINF:6,\nseg1.ts', BASE, PROXY);
    assert.match(out, /^\/api\/tv\/stream\?url=https%3A%2F%2Fcdn\.example\.com%2Flive%2Fseg1\.ts$/m);
  });

  it('keeps absolute URLs absolute inside the proxy parameter', () => {
    const out = rewriteManifest('https://other.cdn/x.ts', BASE, PROXY);
    assert.equal(out, `${PROXY}?url=${encodeURIComponent('https://other.cdn/x.ts')}`);
  });

  it('rewrites URI attributes on tag lines — keys, audio renditions, init maps', () => {
    const manifest = '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8",NAME="pt"';
    const out = rewriteManifest(manifest, BASE, PROXY);
    assert.match(out, /URI="\/api\/tv\/stream\?url=https%3A%2F%2Fcdn\.example\.com%2Flive%2Fkey\.bin"/);
    assert.match(out, /URI="\/api\/tv\/stream\?url=https%3A%2F%2Fcdn\.example\.com%2Flive%2Faudio\.m3u8"/);
    assert.match(out, /NAME="pt"/); // untouched attributes survive
  });

  it('leaves comment and directive lines without a URI alone', () => {
    const manifest = '#EXTM3U\n#EXT-X-VERSION:5\n#EXT-X-TARGETDURATION:6';
    assert.equal(rewriteManifest(manifest, BASE, PROXY), manifest);
  });

  it('preserves blank lines rather than turning them into proxy URLs', () => {
    const out = rewriteManifest('#EXTM3U\n\nseg.ts\n', BASE, PROXY);
    const lines = out.split('\n');
    assert.equal(lines[1], '');
    assert.equal(lines[3], '');
  });

  it('resolves relative URIs against the post-redirect manifest URL', () => {
    // The CDN redirected us to /edge2/; segments must follow it, not the original path.
    const out = rewriteManifest('seg.ts', 'https://cdn.example.com/edge2/live.m3u8', PROXY);
    assert.match(out, /edge2%2Fseg\.ts/);
  });
});

describe('isAllowed', () => {
  const hosts = new Set(['cdn.example.com', 'two.example.com:8080']);

  it('accepts hosts that appear in the catalog', () => {
    assert.equal(isAllowed('https://cdn.example.com/a.m3u8', hosts), true);
    assert.equal(isAllowed('https://two.example.com:8080/b.ts', hosts), true);
  });

  it('is case-insensitive about the host', () => {
    assert.equal(isAllowed('https://CDN.Example.COM/a.m3u8', hosts), true);
  });

  it('rejects anything the catalog never mentioned', () => {
    assert.equal(isAllowed('https://evil.example.com/a.m3u8', hosts), false);
    // The SSRF cases this exists to stop.
    assert.equal(isAllowed('http://169.254.169.254/latest/meta-data/', hosts), false);
    assert.equal(isAllowed('http://localhost:4320/api/snapshot', hosts), false);
    assert.equal(isAllowed('http://127.0.0.1/', hosts), false);
  });

  it('rejects a host that only differs by port', () => {
    assert.equal(isAllowed('https://cdn.example.com:9999/a.m3u8', hosts), false);
  });

  it('rejects non-http schemes and unparseable input', () => {
    assert.equal(isAllowed('file:///etc/passwd', hosts), false);
    assert.equal(isAllowed('ftp://cdn.example.com/a', hosts), false);
    assert.equal(isAllowed('not a url', hosts), false);
    assert.equal(isAllowed('', hosts), false);
  });
});
