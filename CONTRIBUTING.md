# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

The suite is fully offline: sensor tests stub `fetch`, and `crossSignals`/`computeRiskScore` are pure functions with no I/O at all. A test that hits the network will not be merged.

## Adding a sensor

A sensor is a function in `src/sensors/*.ts` that calls `getJson`/`getText` from `src/http.ts` (which already handles timeouts and failure-to-null) and maps the response into one of the shared types in `src/types.ts`. Add it to `src/sensors/index.ts`, wire it into `BrasilMonitor.sensorBundle()` in `src/monitor.ts` with a `withTimeout(..., fallback)` wrapper, and give it a fallback value that keeps the rest of the snapshot working if that one source is down.

Only keyless, official (government/scientific-institution) endpoints belong in `src/sensors/`. Anything that scrapes an HTML page or uses an unofficial API — however useful — is a different trust category and belongs in its own module with its own honest documentation, not folded quietly into this one.

## Changing the risk score or a cross-signal

These are the actual product. If you change a formula or threshold in `src/risk.ts` or `src/cross-signals.ts`, the score for identical input data changes for everyone using this package — treat that like a breaking change, not a tweak. Add or update the corresponding test in `test/risk.test.ts` / `test/cross-signals.test.ts` with the exact numbers you expect, worked out by hand in a comment, the way the existing tests do.

## Rules that matter

- **No new runtime dependencies** without discussion. Zero deps, keyless-only, is the point.
- **Every sensor fails independently.** A `Promise.all` that lets one rejection take down the other seven is a regression.
- **Pure functions stay pure.** `crossSignals` and `computeRiskScore` take data in, return data out — no `fetch`, no clock reads beyond what's passed in, no file I/O.
- Injectable clocks (`now`) on anything time-dependent, like `RiskHistoryStore` already has.

## Pull requests

Explain the failure the change fixes, or the source it adds. A test that fails before and passes after is worth more than a paragraph.
