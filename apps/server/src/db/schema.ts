import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
const num = (name: string) => numeric(name, { precision: 20, scale: 8, mode: 'number' });
const money = (name: string) => numeric(name, { precision: 20, scale: 4, mode: 'number' });

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  settings: jsonb('settings').notNull().default({}),
  ...timestamps,
});

/** One-time magic-link tokens (hashed). */
export const loginTokens = pgTable('login_tokens', {
  id: id(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ...timestamps,
});

export const sessions = pgTable('sessions', {
  id: id(),
  userId: userRef(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: userRef(),
    label: text('label').notNull(),
    firmPreset: text('firm_preset'),
    startingBalance: money('starting_balance').notNull(),
    currency: text('currency').notNull().default('USD'),
    rules: jsonb('rules').notNull(),
    /** Trader's own rules (risk %, max trades/day, stop after N losses, setups). */
    traderRules: jsonb('trader_rules').notNull().default({}),
    startDate: timestamp('start_date', { withTimezone: true }),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    ...timestamps,
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const trades = pgTable(
  'trades',
  {
    id: id(),
    userId: userRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    instrument: text('instrument').notNull().default('XAUUSD'),
    direction: text('direction', { enum: ['long', 'short'] }).notNull(),
    sizeLots: num('size_lots').notNull(),
    entryPrice: num('entry_price').notNull(),
    stopPrice: num('stop_price'),
    targetPrice: num('target_price'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    exitPrice: num('exit_price'),
    pnl: money('pnl'),
    riskAmount: money('risk_amount'),
    rMultiple: numeric('r_multiple', { precision: 12, scale: 4, mode: 'number' }),
    exitType: text('exit_type', { enum: ['target', 'stop', 'manual_close', 'breakeven', 'open'] })
      .notNull()
      .default('open'),
    setupTag: text('setup_tag'),
    preNote: text('pre_note'),
    overrideFlag: boolean('override_flag').notNull().default(false),
    overrideKind: text('override_kind', {
      enum: ['moved_stop', 'moved_target', 'closed_early', 'added_size', 'removed_stop'],
    }),
    overrideNote: text('override_note'),
    source: text('source', { enum: ['manual', 'csv'] })
      .notNull()
      .default('manual'),
    noteLabels: jsonb('note_labels'),
    labelsVersion: text('labels_version'),
    labelsStatus: text('labels_status', { enum: ['pending', 'done', 'failed', 'none'] })
      .notNull()
      .default('pending'),
    importHash: text('import_hash'),
    ...timestamps,
  },
  (t) => [
    index('trades_user_account_opened_idx').on(t.userId, t.accountId, t.openedAt),
    uniqueIndex('trades_user_import_hash_uq').on(t.userId, t.importHash),
  ],
);

export const prechecks = pgTable(
  'prechecks',
  {
    id: id(),
    userId: userRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    input: jsonb('input').notNull(),
    computed: jsonb('computed').notNull(),
    jev: jsonb('jev'),
    verdict: text('verdict', { enum: ['go', 'caution', 'stop'] }).notNull(),
    linkedTradeId: uuid('linked_trade_id').references(() => trades.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('prechecks_user_idx').on(t.userId, t.createdAt)],
);

export const behaviourProfiles = pgTable(
  'behaviour_profiles',
  {
    id: id(),
    userId: userRef(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    tradeCount: integer('trade_count').notNull(),
    metrics: jsonb('metrics').notNull(),
    conditionalProbs: jsonb('conditional_probs').notNull(),
    version: text('version').notNull(),
    ...timestamps,
  },
  (t) => [index('profiles_user_idx').on(t.userId, t.accountId)],
);

export const simulationRuns = pgTable(
  'simulation_runs',
  {
    id: id(),
    userId: userRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    config: jsonb('config').notNull(),
    result: jsonb('result'),
    creditsSpent: integer('credits_spent').notNull().default(0),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('sims_user_idx').on(t.userId, t.createdAt)],
);

export const creditsLedger = pgTable(
  'credits_ledger',
  {
    id: id(),
    userId: userRef(),
    delta: integer('delta').notNull(),
    reason: text('reason', { enum: ['purchase', 'simulation', 'admin_grant', 'refund'] }).notNull(),
    refId: text('ref_id'),
    ...timestamps,
  },
  (t) => [
    index('ledger_user_idx').on(t.userId),
    // Idempotency: one purchase per Stripe session, one charge/refund per simulation.
    uniqueIndex('ledger_reason_ref_uq')
      .on(t.reason, t.refId)
      .where(sql`${t.refId} is not null`),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAfter)],
);

/** Per-user, per-day Jev usage counters (no content). */
export const jevUsage = pgTable(
  'jev_usage',
  {
    id: id(),
    userId: userRef(),
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('jev_usage_user_day_uq').on(t.userId, t.day)],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type Precheck = typeof prechecks.$inferSelect;
export type SimulationRun = typeof simulationRuns.$inferSelect;
export type Job = typeof jobs.$inferSelect;
