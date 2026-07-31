#!/usr/bin/env node
// ============================================================================
// brasil-monitor CLI — a plain-text snapshot of the risk index
// ============================================================================

import { BrasilMonitor } from './monitor.js';
import { serve } from './server.js';

const HELP = `brasil-monitor — Brazil's composite risk index (0-100), from 13 official keyless institutions

Usage
  brasil-monitor serve [--port 4320] [--host 127.0.0.1]   the visual dashboard
  brasil-monitor snapshot [--force]                       everything, as text
  brasil-monitor risk [--force]                           just the index

No API keys, no configuration. Market-derived signals (FX pressure, equity
stress, risk-off/on) are omitted here — wire in your own quote source and
pass { market } to BrasilMonitor.snapshot() as a library.
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function bar(score: number, width = 24): string {
  const filled = Math.round((score / 100) * width);
  return '#'.repeat(filled) + '-'.repeat(width - filled);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  const monitor = new BrasilMonitor();
  const force = args.includes('--force');

  if (command === 'risk') {
    const snapshot = await monitor.snapshot({ force });
    process.stdout.write(`Risco Brasil: ${snapshot.risk.score}/100 (${snapshot.risk.level})\n`);
    process.stdout.write(`[${bar(snapshot.risk.score)}]\n\n`);
    for (const part of snapshot.risk.parts) {
      process.stdout.write(`  ${part.label.padEnd(34)} ${String(part.score).padStart(3)}  ${part.detail}\n`);
    }
    return 0;
  }

  if (command === 'snapshot') {
    const snapshot = await monitor.snapshot({ force });
    process.stdout.write(`Risco Brasil: ${snapshot.risk.score}/100 (${snapshot.risk.level})\n\n`);

    process.stdout.write(`Alertas INMET ativos: ${snapshot.alerts.length}\n`);
    for (const alert of snapshot.alerts.slice(0, 6)) {
      process.stdout.write(`  [${alert.severity}] ${alert.event} — ${alert.ufs.join(', ') || '—'}\n`);
    }

    process.stdout.write(`\nSinais cruzados: ${snapshot.cross.length}\n`);
    for (const signal of snapshot.cross) {
      process.stdout.write(`  ${signal.icon} [${signal.level}] ${signal.title}\n`);
    }

    process.stdout.write(`\nEventos no território (queimadas/desastres): ${snapshot.events.length}\n`);
    process.stdout.write(`Sismos (30d): ${snapshot.quakes.length}\n`);
    process.stdout.write(`Tesouro Direto — títulos negociáveis: ${snapshot.tesouro.length}\n`);

    const economy = snapshot.economy;
    if (economy.regions.length) {
      process.stdout.write(`\nPIB por região (${economy.gdpYear ?? '—'}):\n`);
      for (const region of [...economy.regions].sort((a, b) => b.share - a.share)) {
        process.stdout.write(`  ${region.region.padEnd(14)} ${region.share.toFixed(1).padStart(5)}%  R$ ${(region.gdp / 1e12).toFixed(2)} tri\n`);
      }
    }
    if (snapshot.education.regions.length) {
      process.stdout.write(`\nAnos de estudo (15+, PNAD ${snapshot.education.year ?? '—'}):\n`);
      for (const region of snapshot.education.regions) {
        process.stdout.write(`  ${region.region.padEnd(14)} ${region.yearsOfStudy?.toFixed(1) ?? '—'} anos · analfabetismo ${region.illiteracyRate?.toFixed(1) ?? '—'}%\n`);
      }
    }
    if (snapshot.unemployment) {
      process.stdout.write(`\nDesocupação: ${snapshot.unemployment.value}% (${snapshot.unemployment.date})\n`);
    }

    process.stdout.write(`\nNotícias oficiais: ${snapshot.news.length} · matérias no Senado: ${snapshot.senate.bills.length}\n`);
    const dengueHot = snapshot.dengue.filter(d => d.level >= 3);
    process.stdout.write(`Dengue: ${dengueHot.length} capital(is) em nível 3+ de ${snapshot.dengue.length}\n`);
    return 0;
  }

  if (command === 'serve') {
    const port = Number(flag(args, 'port') ?? 4320);
    const host = flag(args, 'host') ?? '127.0.0.1';
    const server = await serve(monitor, { port, host });

    process.stdout.write(`brasil-monitor dashboard on http://${server.host}:${server.port}\n`);
    await new Promise<void>(resolve => {
      process.on('SIGINT', () => { void server.close().then(resolve); });
      process.on('SIGTERM', () => { void server.close().then(resolve); });
    });
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 1;
}

main()
  .then(code => { process.exitCode = code; })
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
