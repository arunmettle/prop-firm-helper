# Cooldown

A privacy-first web app for prop-firm traders. Log trades in seconds, run a pre-trade check against your own rules, see what you actually do after losses, and simulate your evaluation thousands of times to find the behaviour that decides the outcome.

It never predicts the market, never asks for broker credentials, and every analytics screen says so:
*Based on your own past trades. Past performance does not predict future results. Not financial advice.*

## Quick start (under 10 commands)

Requires Node 20+, pnpm 10, Docker (or a local Postgres 16 on `localhost:5432`).

```bash
cp .env.example .env
pnpm install
pnpm db:up          # docker compose Postgres 16 (+ a cooldown_test database)
pnpm db:migrate
pnpm seed           # optional: demo@cooldown.local with 80 trades and 5 credits
pnpm dev            # API :3001 + worker + web :5173
```

Open http://localhost:5173, enter any email, and click **Dev mode: open sign-in link** (in development the link is also printed in the server log). Seeded demo: sign in as `demo@cooldown.local`.

Without Docker: start any Postgres 16 with user/password/db `cooldown`, create a `cooldown_test` database, and skip `pnpm db:up`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Postgres (if Docker is available), migrations, API, worker and web with reload |
| `pnpm test` | Unit + integration tests (needs Postgres, uses `TEST_DATABASE_URL`) |
| `pnpm test:e2e` | Playwright smoke test (sign in → 3 trades → check → simulation) |
| `pnpm verify` | typecheck + lint + test + build (what CI runs) |
| `pnpm db:migrate` / `pnpm db:generate` | Apply / generate Drizzle migrations |
| `pnpm seed` | Demo data |
| `pnpm admin:grant <email> <n>` | Grant simulation credits (used while payments are off) |

## Layout

```
apps/web       Vite + React + React Router + TanStack Query + Tailwind (dark UI)
apps/server    Fastify API (src/index.ts) and job worker (src/worker.ts), Drizzle + Postgres
packages/core  Pure logic: rule engine, trade math, CSV mapping, behaviour profile,
               pre-trade verdict, Monte Carlo simulator, Jev client + question sets
docs/          PLAN, DECISIONS, RISKS, HANDOFF, NEXT
samples/       Example MT4-style CSV (with account/name columns the importer drops)
```

## Configuration

See `.env.example`. Important switches:

- `JEV_PROVIDER` — `fake` (default, deterministic, offline), `cloudflare` (needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`), `typesafe` (stub, see DECISIONS).
- `RESEND_API_KEY` — send real magic-link emails; empty = print to console.
- `PAYMENTS_ENABLED` — Stripe Checkout for credit packs (test keys only) with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREDIT_PACKS`. Webhook: `POST /api/stripe/webhook`.
- `ADMIN_EMAILS` — who can open `/admin` (model usage and queue health).

## Production

`pnpm --filter @cooldown/web build`, then run `pnpm --filter @cooldown/server start` (serves the API and the built web app on one origin) and `pnpm --filter @cooldown/server start:worker`. Set `NODE_ENV=production` (secure cookies, no dev sign-in link).
