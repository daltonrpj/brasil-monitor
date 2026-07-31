// ---------------------------------------------------------------------------
// The whole point, in one call: 13 official institutions, cross-referenced, no keys.
//
//   npm run build
//   node examples/snapshot.mjs
// ---------------------------------------------------------------------------

import { BrasilMonitor } from '../dist/index.js';

const monitor = new BrasilMonitor();
const snapshot = await monitor.snapshot();

console.log(`Risco Brasil: ${snapshot.risk.score}/100 (${snapshot.risk.level})`);
for (const part of snapshot.risk.parts) {
  console.log(`  ${part.label.padEnd(34)} ${String(part.score).padStart(3)}  ${part.detail}`);
}

console.log(`\n${snapshot.cross.length} sinais cruzados:`);
for (const signal of snapshot.cross) {
  console.log(`  ${signal.icon} [${signal.level}] ${signal.title}`);
  console.log(`     ${signal.detail}`);
}

console.log(`\n${snapshot.alerts.length} alertas INMET ativos, ${snapshot.events.length} eventos no território, ${snapshot.quakes.length} sismos (30d).`);
