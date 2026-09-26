import { eq } from 'drizzle-orm';
import { parseTraderRules, ruleSchema, type BehaviourProfile } from '@cooldown/core';
import { runSimulation, SIM_VERSION, type SimConfig } from '@cooldown/core/sim';
import type { AppCtx } from '../ctx.js';
import type { Tx } from '../db/client.js';
import { creditsLedger, simulationRuns, type Account } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { enqueue } from '../jobs/queue.js';
import { balanceOf, lockLedger } from './credits.js';
import { computeProfile } from './profile.js';

export const SIM_COST = 1;

export function buildSimConfig(
  account: Account,
  profile: BehaviourProfile,
  opts: { runs: number; seed: number },
): SimConfig {
  const rules = ruleSchema.parse(account.rules);
  const tr = parseTraderRules(account.traderRules);
  const probs: SimConfig['measured']['probs'] = {};
  for (const b of profile.conditionalProbs.buckets) probs[`${b.losses}|${b.band}`] = b.smoothed;
  return {
    version: SIM_VERSION,
    rules,
    startingBalance: account.startingBalance,
    trader: {
      riskPct: tr.riskPct,
      maxTradesPerDay: tr.maxTradesPerDay,
      stopAfterLosses: tr.stopAfterLosses,
      tradingDaysPerWeek: tr.tradingDaysPerWeek,
    },
    runs: opts.runs,
    seed: opts.seed,
    maxDays: 60,
    measured: {
      probs,
      planPool: profile.pools.plan,
      tiltPool: profile.pools.tilt,
      tradesPerDay: profile.pools.tradesPerDay,
      sizeUpMultiple: profile.conditionalProbs.sizeUpMultiple,
      historyTrades: profile.tradeCount,
      evidence: profile.conditionalProbs.evidence,
    },
  };
}

/** Charge 1 credit and enqueue the job in ONE transaction. */
export async function startSimulation(
  ctx: AppCtx,
  userId: string,
  account: Account,
  opts: { runs: number; seed?: number },
) {
  const profile = await computeProfile(ctx.db, account);
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const config = buildSimConfig(account, profile, { runs: opts.runs, seed });
  return ctx.db.transaction(async (tx) => {
    await lockLedger(tx, userId);
    const balance = await balanceOf(tx, userId);
    if (balance < SIM_COST) throw new HttpError(402, 'You need 1 credit to run a simulation.');
    const [run] = await tx
      .insert(simulationRuns)
      .values({ userId, accountId: account.id, status: 'queued', config, creditsSpent: SIM_COST })
      .returning();
    await tx.insert(creditsLedger).values({ userId, delta: -SIM_COST, reason: 'simulation', refId: run!.id });
    await enqueue(tx, 'simulate', { runId: run!.id }, { maxAttempts: 2 });
    return run!;
  });
}

export async function simulateJob(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const runId = String(payload.runId);
  const [run] = await ctx.db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).limit(1);
  if (!run || run.status === 'done') return;
  await ctx.db.update(simulationRuns).set({ status: 'running' }).where(eq(simulationRuns.id, runId));
  const result = runSimulation(run.config as SimConfig);
  console.info(
    `[sim] run=${runId} scenarios=${result.scenarios.length} runs=${result.runs} elapsed_ms=${result.elapsedMs}`,
  );
  await ctx.db
    .update(simulationRuns)
    .set({ status: 'done', result, error: null })
    .where(eq(simulationRuns.id, runId));
}

/** Final failure: mark failed and refund automatically (idempotent via the ledger's unique (reason, ref_id)). */
export async function simulateFailed(
  ctx: AppCtx,
  payload: Record<string, unknown>,
  error: string,
): Promise<void> {
  const runId = String(payload.runId);
  await ctx.db.transaction(async (tx: Tx) => {
    const [run] = await tx
      .update(simulationRuns)
      .set({ status: 'failed', error: error.slice(0, 300) })
      .where(eq(simulationRuns.id, runId))
      .returning();
    if (!run || run.creditsSpent <= 0) return;
    await tx
      .insert(creditsLedger)
      .values({ userId: run.userId, delta: run.creditsSpent, reason: 'refund', refId: run.id })
      .onConflictDoNothing();
  });
}

export function simulationDto(r: typeof simulationRuns.$inferSelect, withResult = true) {
  const cfg = r.config as Partial<SimConfig>;
  return {
    id: r.id,
    accountId: r.accountId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    creditsSpent: r.creditsSpent,
    error: r.status === 'failed' ? 'The simulation failed. Your credit was refunded.' : null,
    runs: cfg.runs ?? null,
    seed: cfg.seed ?? null,
    historyTrades: cfg.measured?.historyTrades ?? null,
    trader: cfg.trader ?? null,
    result: withResult ? r.result : undefined,
  };
}
