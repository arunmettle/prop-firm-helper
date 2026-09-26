# Handoff

## How to run it

See README "Quick start". In short: `cp .env.example .env && pnpm install && pnpm db:up && pnpm db:migrate && pnpm seed && pnpm dev`, then open http://localhost:5173 and sign in as `demo@cooldown.local` (click the dev sign-in link).

Checks: `pnpm verify` runs typecheck, lint, 205 tests (151 core, 54 server integration against real Postgres) and the build. `pnpm test:e2e` runs the Playwright smoke test. Both pass as of this handoff.

## What is real vs faked

| Area                                                                                                              | Status                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule engine, trade math, position sizing, behaviour metrics, conditional probabilities, simulator                 | **Real**, pure code in `packages/core`, unit tested (62 rule-engine golden tests).                                                                            |
| Magic-link auth, sessions, rate limits, credits ledger, job queue (`FOR UPDATE SKIP LOCKED`), export, hard delete | **Real**, integration tested.                                                                                                                                 |
| Email                                                                                                             | Console adapter in dev (link also returned as `devLink` outside production). Resend adapter is real but untested against the live API.                        |
| Jev (note classifier, pre-trade state check)                                                                      | **Fake by default** — deterministic keyword + hash heuristics. It looks sensible in demos but is NOT a model.                                                 |
| Cloudflare Jev adapter                                                                                            | Implemented but **unverified**: the docs page was unreachable from the build environment. Check the endpoint and the response envelope before relying on it.  |
| Direct TypeSafe adapter                                                                                           | **Stub** that throws a clear error.                                                                                                                           |
| Stripe                                                                                                            | Real SDK, test-mode keys only, signature-verified idempotent webhook (tested with Stripe's own test signatures). Not exercised against a real Stripe account. |
| Rule presets                                                                                                      | Example data, labelled as examples. Not any firm's official rules.                                                                                            |

## Assumptions worth your review (full list in DECISIONS.md)

1. **Breach semantics:** equity strictly _below_ a floor breaches, and touching it is allowed. Some firms treat touching as a breach.
2. **Daily loss amount:** added `dailyLossAmountBasis` (initial balance by default, or that day's start level) because firms differ and the prompt's schema couldn't express it.
3. **Trailing floors stop at the starting balance** by default (`trailingLockAt`). Trailing intraday uses _realised_ peaks only.
4. **P&L counts on the close day; a trading day counts on the open day.** Min trading days = distinct open days.
5. **Pass condition:** target AND min days AND consistency, checked after each close. After that the status is final.
6. **Simulator behaviour effects:** size-up = the measured multiple (≥1.3×, default 1.5×); a widened stop = 1.5× the loss; an early close = half the winner; extra trades ignore the trader's own stop rules. These modelling choices drive the sensitivity ranking.
7. **Simulator horizon:** 60 calendar days when the rules have no time limit. Risk per trade = % of _current_ balance.
8. **Plan vs tilt:** Jev's `tilt_behaviour` label decides when it is certain. Otherwise transparent heuristics decide. The Insights page shows the split.
9. **CSV:** day-first slash dates, a user-chosen file time zone, zero stops mean none, and stops trailed past entry are dropped.
10. **Signup grants 3 free credits** (`SIGNUP_FREE_CREDITS`) so the simulator is usable while payments are off.

## Open items from RISKS.md

- Floating P&L and intraday equity aren't visible, so real-history rule checks can be optimistic. Dashboard and precheck copy says "closed trades only".
- `start_of_day_equity_or_balance_higher` is approximated by balance.
- CSV stop-loss is usually the _final_ stop. Widened stops overstate risk and understate R.
- CSV time zone mistakes shift trades across day boundaries.
- Instrument contract sizes and point values vary by broker, especially index CFDs.
- Simulator CIs reflect simulation noise only, not uncertainty about the trader's true edge. The pool sizes are shown on every result.
- Winners are assumed not to dip intraday in the simulator.
- P(skip) comes only from unlinked pre-trade checks.
- Mislabelled notes move trades between the plan and tilt pools.

## Privacy & security checklist (verified)

- [x] No field accepts broker credentials. There are no broker integrations. The importer drops password/investor/login columns.
- [x] CSV is parsed client-side. The server accepts a strict whitelist of keys (`z.strictObject`), tested.
- [x] Note text never appears in logs: `test/logs.test.ts` greps all output for a sentinel note across trades, imports, prechecks, validation errors, malformed JSON, and working and failing Jev. Jev logs only keys, latency and tokens.
- [x] Trade data is never pooled, never used for training, and only sent to the configured Jev provider (the fake by default).
- [x] Only email is stored for identity. Session and magic-link tokens are stored as SHA-256 hashes, tested.
- [x] Rate limits on magic-link request/verify, pre-trade checks, re-labelling, simulations, checkout and account deletion.
- [x] Every query is scoped by `user_id`. Tests confirm user B cannot read or modify user A's accounts, trades, prechecks, simulations, evidence or profile, and cannot link A's check.
- [x] JSON/CSV export (CSV neutralises formula injection) and a one-transaction hard delete are tested, and the delete leaves other users intact.
- [x] Secrets come only from env. `.env` is gitignored.

## First five things to test with real trade data

1. **Rule engine vs your firm's dashboard.** Import a real evaluation history and compare balance, daily loss used, max-loss floor and pass/breach dates day by day. Try a trailing-drawdown account and a day with a trade held over the reset.
2. **CSV import from 2–3 real broker exports** (MT4, MT5 positions, cTrader). Check the dropped columns, the time zone and the P&L (gross vs net).
3. **Position sizing on non-USD accounts and index CFDs.** Check the point-value overrides against the broker's contract spec.
4. **The real Jev (OpenRouter) on about 50 real notes** — start with `pnpm jev:ping`. Check label quality, how often labels come back uncertain, latency (precheck must stay under 1.5 s end to end) and cost per user in `/admin`.
5. **The simulator on 30–100 real trades.** Check whether the top-ranked behaviour matches what the trader recognises in the evidence list, and whether results are stable across seeds.
