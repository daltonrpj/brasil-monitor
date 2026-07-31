import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RiskHistoryStore } from '../src/store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'brasil-monitor-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('RiskHistoryStore', () => {
  it('records a point', () => {
    const store = new RiskHistoryStore(dir);
    store.save(42);
    assert.equal(store.history(10)[0]!.score, 42);
  });

  it('throttles points within the 3-minute window', () => {
    const store = new RiskHistoryStore(dir);
    store.save(10);
    store.save(20); // too soon — dropped
    assert.equal(store.history(10).length, 1);
    assert.equal(store.history(10)[0]!.score, 10);
  });

  it('survives a restart — history is read back from disk', () => {
    const store = new RiskHistoryStore(dir);
    store.save(55);

    const reopened = new RiskHistoryStore(dir);
    assert.equal(reopened.history(10)[0]!.score, 55);
  });

  it('returns an empty list before anything is saved', () => {
    assert.deepEqual(new RiskHistoryStore(dir).history(10), []);
  });

  it('truncates to the requested limit, keeping the most recent points', () => {
    const c = clock();
    const store = new RiskHistoryStore(dir, { now: c.now });
    for (let score = 1; score <= 5; score++) {
      store.save(score);
      c.advance(3 * 60 * 1000 + 1); // clear the throttle window between saves
    }
    const limited = store.history(2);
    assert.equal(limited.length, 2);
    assert.deepEqual(limited.map(p => p.score), [4, 5]);
  });

  it('does not throttle once the window has passed', () => {
    const c = clock();
    const store = new RiskHistoryStore(dir, { now: c.now });
    store.save(1);
    c.advance(3 * 60 * 1000 + 1);
    store.save(2);
    assert.deepEqual(store.history(10).map(p => p.score), [1, 2]);
  });
});
