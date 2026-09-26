import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  buildProfile,
  parseTraderRules,
  ruleSchema,
  type BehaviourProfile,
  type BTrade,
} from '@cooldown/core';
import type { NoteLabels } from '@cooldown/core/jev';
import type { Tx } from '../db/client.js';
import { behaviourProfiles, prechecks, trades, type Account } from '../db/schema.js';

/** Compute the behaviour profile for one account from its closed trades (+ unlinked prechecks) and store it. */
export async function computeProfile(db: Tx, account: Account): Promise<BehaviourProfile> {
  const rules = ruleSchema.parse(account.rules);
  const tr = parseTraderRules(account.traderRules);
  const rows = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.userId, account.userId),
        eq(trades.accountId, account.id),
        isNotNull(trades.closedAt),
        isNotNull(trades.pnl),
      ),
    )
    .orderBy(asc(trades.openedAt));
  const pcs = await db
    .select({
      createdAt: prechecks.createdAt,
      verdict: prechecks.verdict,
      linkedTradeId: prechecks.linkedTradeId,
    })
    .from(prechecks)
    .where(and(eq(prechecks.userId, account.userId), eq(prechecks.accountId, account.id)));
  const bt: BTrade[] = rows.map((t) => ({
    id: t.id,
    openedAt: t.openedAt,
    closedAt: t.closedAt!,
    pnl: t.pnl!,
    rMultiple: t.rMultiple,
    sizeLots: t.sizeLots,
    riskAmount: t.riskAmount,
    setupTag: t.setupTag,
    exitType: t.exitType,
    overrideFlag: t.overrideFlag,
    overrideKind: t.overrideKind,
    noteLabels: t.labelsStatus === 'done' ? (t.noteLabels as NoteLabels) : null,
  }));
  const profile = buildProfile(
    bt,
    {
      timezone: rules.dayResetTimezone,
      startingBalance: account.startingBalance,
      dailyLossLimit: (account.startingBalance * rules.maxDailyLossPct) / 100,
      maxTradesPerDay: tr.maxTradesPerDay,
      stopAfterLosses: tr.stopAfterLosses,
      cooldownMinutes: tr.cooldownMinutes,
    },
    pcs.map((p) => ({ createdAt: p.createdAt, verdict: p.verdict, linked: !!p.linkedTradeId })),
  );
  await db.transaction(async (tx) => {
    await tx
      .delete(behaviourProfiles)
      .where(and(eq(behaviourProfiles.userId, account.userId), eq(behaviourProfiles.accountId, account.id)));
    await tx.insert(behaviourProfiles).values({
      userId: account.userId,
      accountId: account.id,
      tradeCount: profile.tradeCount,
      metrics: { ...profile.metrics, insights: profile.insights, pools: profile.pools },
      conditionalProbs: profile.conditionalProbs,
      version: profile.version,
    });
  });
  return profile;
}
