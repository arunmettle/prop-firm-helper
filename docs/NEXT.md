# Next (out of scope for the MVP)

Seams left in place:

- **TradingView / browser extension.** The API is already the backend: `POST /api/prechecks` takes a planned trade and returns size, budgets and verdict; `POST /api/trades` accepts `precheckId` to link. An extension would need a token-based auth flow (today: cookie sessions).
- **Mobile apps.** Same API; the web UI is responsive down to tablet.
- **Broker/platform APIs and live prices/ATR.** Deliberately not built (no credentials, no market data). CSV import (`packages/core/src/csv`) is the only ingestion path; a future read-only integration should reuse the same whitelist.
- **MT5 deals-format CSV** (in/out rows per position) — needs a position-reconstruction step before `mapCsvRow`.
- **MAE capture.** The simulator accepts a `worstPnl` per trade; storing MAE on trades would replace the −1R assumption.
- **Direct TypeSafe adapter** (`packages/core/src/jev/typesafe.ts`) once the API docs are available.
- **Weekly summary view** (one per week, no streaks).
- **Social features, multi-language, teams** — not planned.
