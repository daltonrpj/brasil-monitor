// ---------------------------------------------------------------------------
// This package does not fetch market quotes — plug in whatever source you
// already have. Three market-derived cross-signals (risk-off/on, agro-belt
// commodities, FX/equity stress) only fire once you supply `market`.
//
//   npm run build
//   node examples/with-market.mjs
// ---------------------------------------------------------------------------

import { BrasilMonitor } from '../dist/index.js';

// Any source works here — Yahoo Finance, Binance, a broker feed, a paid
// data vendor. This example fakes today's moves for illustration.
const market = {
  dolarChangePct: 0.6,     // dollar up 0.6% today
  ibovChangePct: -0.5,     // Ibovespa down 0.5% today
  soybeanChangePct: -1.2,
  cornChangePct: 0.3,
};

const monitor = new BrasilMonitor();
const snapshot = await monitor.snapshot({ market });

console.log(`Risco Brasil: ${snapshot.risk.score}/100 (with market pressure factored in)`);
const marketSignal = snapshot.cross.find(s => /Risk-(on|off)/.test(s.title));
if (marketSignal) console.log(`  ${marketSignal.icon} ${marketSignal.title}: ${marketSignal.detail}`);
