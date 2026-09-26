/**
 * pnpm seed — creates a demo user with an account, ~80 imported trades (from samples/), note labels via the
 * configured Jev client (fake by default), and 5 credits. Idempotent: re-running reuses the demo user.
 */
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RULE_PRESETS, guessMapping, mapCsvRow, parseUserSettings, tradeInputSchema } from '@cooldown/core';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { accounts, trades, users } from '../db/schema.js';
import { ConsoleEmailSender } from '../lib/email.js';
import { createJevFromConfig } from '../services/jev.js';
import { buildTradeRow } from '../services/trades.js';
import { importHash } from '../routes/import.js';
import { onTradesChanged } from '../services/labelling.js';
import { drain } from '../jobs/queue.js';
import { handlers } from '../jobs/handlers.js';
import { grantCredits } from '../services/credits.js';
import type { AppCtx } from '../ctx.js';

const EMAIL = process.env.SEED_EMAIL ?? 'demo@cooldown.local';
const cfg = loadConfig();
const { db, pool } = createDb(cfg.databaseUrl);
await runMigrations(db);
const ctx: AppCtx = { cfg, db, email: new ConsoleEmailSender(), jev: createJevFromConfig(cfg) };

let [user] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
if (!user) [user] = await db.insert(users).values({ email: EMAIL, settings: parseUserSettings({}) }).returning();
let [account] = await db.select().from(accounts).where(eq(accounts.userId, user!.id)).limit(1);
if (!account) {
  [account] = await db
    .insert(accounts)
    .values({
      userId: user!.id,
      label: '100k Challenge · Phase 1',
      firmPreset: RULE_PRESETS[0]!.id,
      startingBalance: 100_000,
      currency: 'USD',
      rules: RULE_PRESETS[0]!.rules,
      traderRules: { riskPct: 1, maxTradesPerDay: 3, stopAfterLosses: 2, tradingDaysPerWeek: 5, cooldownMinutes: 30, setups: ['London breakout retest', 'NY open liquidity sweep', 'Pullback to 4h demand'] },
      startDate: new Date('2026-06-01T00:00:00Z'),
    })
    .returning();
}

const csvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../samples/mt4-history-sample.csv');
const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')).slice(0, -1);
const headers = split(header!);
const rows = lines.map((l) => Object.fromEntries(split(l).map((v, i) => [headers[i], v])));
const mapping = guessMapping(headers.filter((h) => !['Account', 'Name'].includes(h)));
const values = [];
for (const r of rows) {
  const m = mapCsvRow(r, mapping, { timezone: 'UTC', defaultInstrument: 'XAUUSD' });
  if (!m.ok) continue;
  const input = tradeInputSchema.parse({ ...m.trade, accountId: account!.id });
  const { row } = buildTradeRow(input, account!, user!, 'csv');
  values.push({ ...row, userId: user!.id, accountId: account!.id, importHash: importHash(input) });
}
const inserted = await db.insert(trades).values(values).onConflictDoNothing({ target: [trades.userId, trades.importHash] }).returning({ id: trades.id });
await db.transaction((tx) => onTradesChanged(ctx, tx, user!.id, inserted.map((t) => t.id)));
await drain(ctx, handlers);
if (inserted.length) await grantCredits(db, user!.id, 5, `seed:${user!.id}`);

console.info(`\nSeeded ${EMAIL}: ${inserted.length} new trades (labels via ${ctx.jev.provider} Jev).`);
console.info('Sign in: open the app, enter that email, and click the dev sign-in link.\n');
await pool.end();
