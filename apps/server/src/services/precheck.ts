import { and, asc, desc, eq } from 'drizzle-orm';
import {
  buildComputed,
  decideVerdict,
  evaluateAccount,
  groupStat,
  isValidTimeZone,
  parseTraderRules,
  parseUserSettings,
  pointValue,
  ruleSchema,
  sessionOf,
  sizePosition,
  todayStats,
  type BTrade,
  type PrecheckInput,
  type PrecheckJevView,
} from '@cooldown/core';
import { isUncertain, PRECHECK_V1 } from '@cooldown/core/jev';
import type { AppCtx } from '../ctx.js';
import { prechecks, trades, type Account, type User } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { callJev } from './jev.js';

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export async function runPrecheck(
  ctx: AppCtx,
  user: User,
  account: Account,
  input: PrecheckInput,
  now = new Date(),
) {
  const rules = ruleSchema.parse(account.rules);
  const tr = parseTraderRules(account.traderRules);
  const settings = parseUserSettings(user.settings);
  const pv = pointValue(input.instrument, account.currency, settings.instruments);
  if (!pv.ok) throw new HttpError(400, pv.reason);

  const rows = await ctx.db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, user.id), eq(trades.accountId, account.id)))
    .orderBy(asc(trades.openedAt));
  const closed = rows.filter((r) => r.closedAt && r.pnl !== null && r.closedAt <= now);
  const evalTrades = closed.map((r) => ({ openedAt: r.openedAt, closedAt: r.closedAt!, pnl: r.pnl! }));
  const opts = { asOf: now, startDate: account.startDate ?? undefined };
  const before = evaluateAccount(rules, account.startingBalance, evalTrades, null, opts);
  const sizing = sizePosition(input, before.balance, pv.value, account.currency);
  const evaluation = evaluateAccount(rules, account.startingBalance, evalTrades, sizing.actualRisk, opts);
  const today = todayStats(rows, rules.dayResetTimezone, now);
  const session = sessionOf(now);

  const toB = (t: (typeof rows)[number]): BTrade => ({
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
    noteLabels: null,
  });
  const matching = closed.filter(
    (t) => (t.setupTag ?? null) === (input.setupTag || null) && sessionOf(t.openedAt) === session,
  );
  const computed = buildComputed({
    input,
    evaluation,
    sizing,
    today,
    traderRules: tr,
    session,
    history: matching.length ? groupStat(input.setupTag ?? 'untagged', matching.map(toB)) : null,
    baselineRisk: median(closed.map((t) => t.riskAmount ?? 0).filter((x) => x > 0)),
  });

  // Everything the model needs, nothing that identifies the user.
  const recent = [...closed].slice(-5).map((t) => {
    const l = t.noteLabels as { primary_driver?: { value: string; uncertain: boolean } } | null;
    return {
      closed_minutes_ago: Math.round((now.getTime() - t.closedAt!.getTime()) / 60_000),
      r_multiple: t.rMultiple,
      pnl_sign: Math.sign(t.pnl!),
      exit_type: t.exitType,
      override_kind: t.overrideKind,
      note_driver: l?.primary_driver && !l.primary_driver.uncertain ? l.primary_driver.value : null,
    };
  });
  const state = {
    planned_trade: {
      instrument: input.instrument,
      direction: input.direction,
      entry: input.entry,
      stop: input.stop,
      target: input.target,
    },
    setup_tag: input.setupTag,
    pre_note: input.preNote,
    computed: {
      risk_pct: sizing.actualRiskPct,
      reward_risk: sizing.rewardRisk,
      daily_loss_remaining_after: computed.dailyLossRemainingAfter,
      exceeds_daily_budget: computed.exceedsDailyBudget,
      size_above_usual: computed.sizeAboveBaseline,
    },
    today: {
      trades_so_far: today.tradesToday,
      consecutive_losses: today.consecutiveLossesToday,
      minutes_since_last_loss: today.minutesSinceLastLoss,
      pnl_sign: Math.sign(today.pnlToday),
    },
    recent_trades: recent,
    stated_setups: tr.setups,
    rules: {
      max_trades_per_day: tr.maxTradesPerDay,
      stop_after_losses: tr.stopAfterLosses,
      cooldown_minutes: tr.cooldownMinutes,
    },
  };

  let jev: PrecheckJevView;
  try {
    const r = await callJev(ctx, user.id, 'precheck', state, PRECHECK_V1);
    const a = r.answers;
    jev = {
      status: 'ok',
      tilt_risk: {
        value: PRECHECK_V1.tilt_risk.criteria[a.tilt_risk.score] ?? String(a.tilt_risk.score),
        score: a.tilt_risk.score,
        confidence: a.tilt_risk.confidence,
        uncertain: isUncertain(a.tilt_risk),
      },
      matches_stated_setup: {
        p: a.matches_stated_setup.noul,
        uncertain: isUncertain(a.matches_stated_setup),
      },
      likely_impulse: { p: a.likely_impulse.noul, uncertain: isUncertain(a.likely_impulse) },
    };
  } catch {
    jev = { status: 'failed' };
  }

  const { verdict, reasons } = decideVerdict(computed, jev, account.currency);
  const settingsTz = isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';
  const [row] = await ctx.db
    .insert(prechecks)
    .values({
      userId: user.id,
      accountId: account.id,
      input,
      computed: { ...computed, reasons, userTimezone: settingsTz },
      jev,
      verdict,
    })
    .returning();
  return precheckDto(row!);
}

export function precheckDto(p: typeof prechecks.$inferSelect) {
  const computed = p.computed as Record<string, unknown>;
  return {
    id: p.id,
    accountId: p.accountId,
    createdAt: p.createdAt.toISOString(),
    input: p.input,
    computed,
    reasons: computed.reasons,
    jev: p.jev,
    verdict: p.verdict,
    linkedTradeId: p.linkedTradeId,
  };
}

export async function recentPrechecks(ctx: AppCtx, userId: string, accountId: string) {
  const rows = await ctx.db
    .select()
    .from(prechecks)
    .where(and(eq(prechecks.userId, userId), eq(prechecks.accountId, accountId)))
    .orderBy(desc(prechecks.createdAt))
    .limit(20);
  return rows.map(precheckDto);
}
