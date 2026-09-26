# Decisions

One line each: decision — why.

- Core package is consumed as TypeScript source (no build step); server runs via `tsx`, web via Vite — fewer moving parts for an MVP.
- Integration tests run against a real Postgres database (`TEST_DATABASE_URL`, created by docker-compose's init script) — the job queue relies on `FOR UPDATE SKIP LOCKED`, so we test against the real thing.
- In non-production with the console email adapter, `/api/auth/request` also returns the magic link (`devLink`) so local sign-in and the e2e test are one click — never enabled when Resend is configured or `NODE_ENV=production`.
- Session cookie `secure` flag is set only when `NODE_ENV=production` (plain-http localhost in dev); always httpOnly + SameSite=Lax.
- Signup grants `SIGNUP_FREE_CREDITS` (default 3) as an `admin_grant` ledger row with ref `signup:<userId>` so a new user can try the simulator without payments; set to 0 to disable.
- Added a `login_tokens` table (hashed one-time magic-link tokens) and a `jev_usage` table (per-user/day counters) beyond §3 — both required by the auth and usage-tracking requirements.
- Added columns beyond §3: `accounts.trader_rules` (the trader's own rules), `accounts.start_date`, `trades.labels_status`, `trades.import_hash`, `jobs.max_attempts/locked_at` — each is required by a behaviour the prompt specifies.
- Money/price columns use `numeric` (exact decimals) mapped to JS numbers; all limit comparisons are done in integer cents.
- Rule engine is a single incremental state machine (`RuleEngine`); `evaluateAccount` (real history) and the simulator both drive it, so rules exist once.
- Breach = equity strictly BELOW a floor, compared in integer cents. Exactly at the limit is allowed; profit target is reached at `>=`.
- When one move crosses both the daily and max-loss floors, the higher floor (crossed first) is reported; ties report `max_loss`.
- P&L counts on the day a trade CLOSES (firm time zone); the trading day counts on the day it OPENS. Min trading days = distinct open-days.
- Added rule-schema extension `dailyLossAmountBasis` (`initial_balance` default | `day_start`): firms differ on what the daily % is a percentage of, and the prompt's schema couldn't express it.
- Added rule-schema extension `trailingLockAt` (`starting_balance` default | `never`): trailing floors commonly stop at the starting balance.
- Pass requires: target reached AND min trading days AND consistency rule satisfied, evaluated after each closed trade. Once passed/breached/timed out, the status is final (later trades only move the displayed balance).
- Calendar-day limit: day N (1-based, from `accounts.start_date` or the first trade's day) > `maxCalendarDays` without a pass → `timed_out` (reported separately from rule breaches).
- Instrument point values are config (`packages/core/src/trades/instruments.ts`); when the quote currency differs from the account currency we refuse to compute and ask for a user override instead of guessing an FX rate.
