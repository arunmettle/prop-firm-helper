# Cooldown — build plan

Source of truth: the build prompt (sections 1–13). This file tracks phases, tasks, and definition of done (DoD).
Every phase ends with: typecheck ✅ lint ✅ tests ✅ app boots ✅ → commit.

## Phase 1 — Skeleton

- [ ] pnpm monorepo (`apps/web`, `apps/server`, `packages/core`), strict TS, ESLint, Prettier
- [ ] docker-compose Postgres 16, `.env.example`
- [ ] Drizzle schema for all tables in §3 + migrations (`pnpm db:migrate`)
- [ ] Fastify server + `/api/health`, worker entrypoint polling `jobs` with `FOR UPDATE SKIP LOCKED`
- [ ] Magic-link auth (console email adapter, Resend adapter), hashed session tokens, httpOnly cookie
- [ ] Vite + React + Router + TanStack Query + Tailwind shell, dark theme
- [ ] CI script (`pnpm verify`)
- DoD: sign in locally, see an empty dashboard.

## Phase 2 — Rule engine

- [ ] zod rule schema, 3 example presets (data)
- [ ] `evaluateAccount` (timezone day boundaries, static/trailing EOD/trailing intraday, consistency, min days, max calendar days)
- [ ] 40+ golden tests
- [ ] Account CRUD API + UI with preset picker and full rule editing
- DoD: create/edit account; rule status visible on dashboard.

## Phase 3 — Trade logging

- [ ] Trade schema + computations (risk_amount, pnl, r_multiple) in core with tests
- [ ] Fast keyboard-first entry form, list with filters, edit/delete, override UI
- DoD: log a trade in < 10 s.

## Phase 4 — CSV import

- [ ] papaparse in browser, column mapping (saved per user), sensitive-column detection + drop report, preview
- [ ] Server whitelist, idempotent import hash
- DoD: import a broker CSV twice → no duplicates.

## Phase 5 — Jev

- [ ] Typed JevClient, zod response validation, retry, cloudflare/typesafe/fake adapters
- [ ] NOTE_CLASSIFIER_V1 / PRECHECK_V1 / BEHAVIOUR_V1 question sets
- [ ] Label job on create/import, re-label, uncertain handling, keepRawNotes, usage tracking, no state logging
- DoD: trades get labels via fake client; admin sees token usage.

## Phase 6 — Behaviour profile

- [ ] Deterministic metrics (6.1), Jev aggregates (6.2), conditional probabilities (6.3) with smoothing
- [ ] Insights page with sample sizes, n<10 hiding, charts, evidence drill-down
- DoD: seeded user sees a full profile.

## Phase 7 — Pre-trade check

- [ ] Position sizing, R:R, budgets, history stats (core, tested)
- [ ] PRECHECK_V1 call, verdict in code, reasons as sentences, "Log this trade"
- DoD: precheck returns verdict + reasons; links to trade.

## Phase 8 — Simulator

- [ ] Seeded Monte Carlo using rule engine, scenarios, sensitivity sweep, Wilson CIs, archetypes
- [ ] Worker job, credit deduction in same tx, refund on failure, results page with evidence
- DoD: 10k runs × all scenarios < 20 s; deterministic tests pass.

## Phase 9 — Credits + payments

- [ ] Ledger, balance, `pnpm admin:grant`, Stripe Checkout behind `PAYMENTS_ENABLED`, verified idempotent webhook

## Phase 10 — Privacy + polish

- [ ] Settings, export JSON/CSV, hard delete, disclaimers, empty/error states
- [ ] Log sentinel test, cross-user isolation tests, rate limiting
- [ ] Playwright smoke test, README, HANDOFF, NEXT
