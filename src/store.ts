// ============================================================================
// Risk history store — enough persistence for a trend sparkline
//
// One JSON file, atomic writes (temp file + rename), capped at 300 points. A
// point is only recorded if at least 3 minutes have passed since the last one
// — the index is recomputed far more often than that, and a sparkline does
// not need every tick.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RiskHistoryPoint } from './types.js';

const MIN_INTERVAL_MS = 3 * 60 * 1000;
const MAX_POINTS = 300;

export interface RiskHistoryStoreOptions {
  /** Injectable clock, for deterministic tests of the throttle window. */
  now?: () => number;
}

export class RiskHistoryStore {
  private readonly file: string;
  private readonly now: () => number;

  constructor(dir: string, options: RiskHistoryStoreOptions = {}) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'risk-history.json');
    this.now = options.now ?? Date.now;
  }

  private read(): RiskHistoryPoint[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(points: RiskHistoryPoint[]): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(points));
      renameSync(temp, this.file);
    } catch {
      // Losing the sparkline history is not worth failing the caller over.
    }
  }

  save(score: number): void {
    const points = this.read();
    const last = points.at(-1);
    if (last && this.now() - last.at < MIN_INTERVAL_MS) return;

    points.push({ at: this.now(), score });
    this.write(points.slice(-MAX_POINTS));
  }

  history(limit = 120): RiskHistoryPoint[] {
    return this.read().slice(-limit);
  }
}

export function defaultHistoryDir(): string {
  return join(process.cwd(), '.brasil-monitor');
}

export const historyFileExists = (dir: string): boolean => existsSync(join(dir, 'risk-history.json'));
