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
