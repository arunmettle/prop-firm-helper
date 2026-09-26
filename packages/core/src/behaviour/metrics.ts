import { roundTo } from '../money.js';
import { sessionOf, weekdayOfKey, WEEKDAYS, type SessionConfig, DEFAULT_SESSIONS } from '../time.js';
import { classifyBehaviour, enrich, type EnrichedTrade } from './classify.js';
import { buildConditionalProbs } from './conditional.js';
import {
  MIN_N,
  type BPrecheck,
  type BTrade,
  type BehaviourContext,
  type ConditionalProbs,
  type GroupStat,
} from './types.js';

export const PROFILE_VERSION = 'profile-v1';

export function groupStat(key: string, ts: BTrade[]): GroupStat {
  const withR = ts.filter((t) => t.rMultiple !== null);
  const wins = ts.filter((t) => t.pnl > 0).length;
  const netR = withR.reduce((s, t) => s + t.rMultiple!, 0);
  return {
    key,
    n: ts.length,
    nR: withR.length,
    winRate: ts.length ? wins / ts.length : null,
    avgR: withR.length ? roundTo(netR / withR.length, 3) : null,
    netR: roundTo(netR, 2),
    netPnl: roundTo(
      ts.reduce((s, t) => s + t.pnl, 0),
      2,
    ),
    tradeIds: ts.map((t) => t.id),
  };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const R_BINS: [string, number, number][] = [
  ['≤ −1.5R', -Infinity, -1.5],
  ['−1.5 to −0.5R', -1.5, -0.5],
  ['−0.5 to +0.5R', -0.5, 0.5],
  ['+0.5 to +1.5R', 0.5, 1.5],
  ['+1.5 to +2.5R', 1.5, 2.5],
  ['> +2.5R', 2.5, Infinity],
];

export interface Comparison {
  label: string;
  a: GroupStat;
  b: GroupStat;
}

export interface Insight {
  id: string;
  text: string;
  n: number;
  tone: 'neutral' | 'caution' | 'positive';
  tradeIds: string[];
}

export interface BehaviourProfile {
  version: string;
  tradeCount: number;
  metrics: {
    overall: GroupStat & { expectancyMoney: number | null };
    rDistribution: { bin: string; n: number }[];
    bySetup: GroupStat[];
    bySession: GroupStat[];
    byWeekday: GroupStat[];
    sizing: {
      basis: 'risk' | 'lots';
      baseline: number | null;
      afterLoss: { n: number; avg: number | null; ratio: number | null; tradeIds: string[] };
      afterWin: { n: number; avg: number | null; ratio: number | null; tradeIds: string[] };
    };
    reentry: {
      medianMinutesAfterLoss: number | null;
      nAfterLoss: number;
      medianMinutesAfterWin: number | null;
      nAfterWin: number;
    };
    tradesPerDay: {
      distribution: { trades: number; days: number }[];
      days: number;
      overMaxDays: string[];
      overMaxTradeIds: string[];
    };
    overrides: {
      n: number;
      rate: number | null;
      overridden: GroupStat;
      notOverridden: GroupStat;
      byKind: GroupStat[];
    };
    soonAfterLoss: { minutes: number; within: GroupStat; others: GroupStat };
    stopAfterLosses: {
      rule: number | null;
      daysReached: number;
      daysContinued: number;
      compliance: number | null;
      tradesAfterRule: GroupStat;
    };
    labels: {
      labelled: number;
      uncertain: number;
      byDriver: GroupStat[];
      planAdherence: { n: number; rate: number | null };
      driverAfterLoss: { key: string; n: number; share: number }[];
      driverAfterWin: { key: string; n: number; share: number }[];
    };
  };
  conditionalProbs: ConditionalProbs;
  pools: { plan: number[]; tilt: number[]; planIds: string[]; tiltIds: string[]; tradesPerDay: number[] };
  insights: Insight[];
}

export function buildProfile(
  trades: BTrade[],
  ctx: BehaviourContext,
  prechecks: BPrecheck[] = [],
  sessions: SessionConfig = DEFAULT_SESSIONS,
): BehaviourProfile {
  const withRisk = trades.filter((t) => t.riskAmount !== null && t.riskAmount > 0).length;
  const sizeBasis: 'risk' | 'lots' = trades.length && withRisk / trades.length >= 0.8 ? 'risk' : 'lots';
  const et = enrich(trades, ctx, sizeBasis);
  const sizes = et.map((t) => t.size).filter((s) => s > 0);
  const baseline = median(sizes);
  const beh = new Map(et.map((t) => [t.id, classifyBehaviour(t, ctx, baseline)]));

  const overall = groupStat('all', et);
  const group = (fn: (t: EnrichedTrade) => string | null) => {
    const m = new Map<string, EnrichedTrade[]>();
    for (const t of et) {
      const k = fn(t);
      if (k === null) continue;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  };

  const bySetup = [...group((t) => t.setupTag ?? 'Untagged')]
    .map(([k, v]) => groupStat(k, v))
    .sort((a, b) => b.n - a.n);
  const sessionOrder = ['asia', 'london', 'ny', 'off'];
  const bySession = [...group((t) => sessionOf(new Date(t.open), sessions))]
    .map(([k, v]) => groupStat(k, v))
    .sort((a, b) => sessionOrder.indexOf(a.key) - sessionOrder.indexOf(b.key));
  const byWeekday = [...group((t) => String(weekdayOfKey(t.day)))]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => groupStat(WEEKDAYS[Number(k)]!, v));

  const afterLoss = et.filter((t) => t.prevOutcome === 'loss');
  const afterWin = et.filter((t) => t.prevOutcome === 'win');
  const avgSize = (ts: EnrichedTrade[]) =>
    ts.length ? ts.reduce((s, t) => s + t.size, 0) / ts.length : null;
  const ratio = (x: number | null) => (x !== null && baseline ? roundTo(x / baseline, 2) : null);

  // Trades per day
  const days = group((t) => t.day);
  const dist = new Map<number, number>();
  for (const [, v] of days) dist.set(v.length, (dist.get(v.length) ?? 0) + 1);
  const overMaxDays = ctx.maxTradesPerDay
    ? [...days].filter(([, v]) => v.length > ctx.maxTradesPerDay!).map(([k]) => k)
    : [];

  // Overrides
  const ov = et.filter((t) => t.overrideFlag);
  const byKind = [...group((t) => (t.overrideFlag ? (t.overrideKind ?? 'other') : null))].map(([k, v]) =>
    groupStat(k, v),
  );

  // Soon after a loss
  const within = et.filter(
    (t) =>
      t.minutesSinceLoss !== null && t.minutesSinceLoss <= ctx.cooldownMinutes && t.prevOutcome === 'loss',
  );
  const withinIds = new Set(within.map((t) => t.id));

  // Stop-after-N compliance: per day, did the losing streak (within the day) reach N, and were trades taken after?
  let daysReached = 0;
  let daysContinued = 0;
  const afterRule: EnrichedTrade[] = [];
  if (ctx.stopAfterLosses) {
    for (const [, v] of days) {
      const ordered = [...v].sort((a, b) => a.open - b.open);
      let streak = 0;
      let reachedAt: number | null = null;
      for (const t of [...v].sort((a, b) => a.close - b.close)) {
        streak = t.pnl < 0 ? streak + 1 : 0;
        if (streak >= ctx.stopAfterLosses) {
          reachedAt = t.close;
          break;
        }
      }
      if (reachedAt !== null) {
        daysReached++;
        const later = ordered.filter((t) => t.open >= reachedAt!);
        if (later.length) {
          daysContinued++;
          afterRule.push(...later);
        }
      }
    }
  }

  // Jev-derived aggregates
  const certain = et.filter((t) => t.noteLabels && !t.noteLabels.primary_driver.uncertain);
  const uncertainN = et.filter((t) => t.noteLabels && t.noteLabels.primary_driver.uncertain).length;
  const byDriver = [
    ...group((t) =>
      t.noteLabels && !t.noteLabels.primary_driver.uncertain ? t.noteLabels.primary_driver.value : null,
    ),
  ]
    .map(([k, v]) => groupStat(k, v))
    .sort((a, b) => b.n - a.n);
  const adherenceKnown = et.filter((t) => t.noteLabels && !t.noteLabels.followed_own_plan.uncertain);
  const share = (ts: EnrichedTrade[]) => {
    const c = ts.filter((t) => t.noteLabels && !t.noteLabels.primary_driver.uncertain);
    const m = new Map<string, number>();
    for (const t of c)
      m.set(t.noteLabels!.primary_driver.value, (m.get(t.noteLabels!.primary_driver.value) ?? 0) + 1);
    return [...m].map(([key, n]) => ({ key, n, share: n / c.length })).sort((a, b) => b.n - a.n);
  };

  // Pools for the simulator
  const planT = et.filter((t) => t.rMultiple !== null && !beh.get(t.id)!.tilt);
  const tiltT = et.filter((t) => t.rMultiple !== null && beh.get(t.id)!.tilt);
  const plannedPerDay = [...days]
    .map(([, v]) => v.filter((t) => !beh.get(t.id)!.extraTrade).length)
    .filter((n) => n > 0);

  const conditionalProbs = buildConditionalProbs(et, beh, prechecks, ctx, baseline, sizeBasis);

  const metrics: BehaviourProfile['metrics'] = {
    overall: { ...overall, expectancyMoney: et.length ? roundTo(overall.netPnl / et.length, 2) : null },
    rDistribution: R_BINS.map(([bin, lo, hi]) => ({
      bin,
      n: et.filter((t) => t.rMultiple !== null && t.rMultiple > lo && t.rMultiple <= hi).length,
    })),
    bySetup,
    bySession,
    byWeekday,
    sizing: {
      basis: sizeBasis,
      baseline: baseline !== null ? roundTo(baseline, 2) : null,
      afterLoss: {
        n: afterLoss.length,
        avg: avgSize(afterLoss),
        ratio: ratio(avgSize(afterLoss)),
        tradeIds: afterLoss.map((t) => t.id),
      },
      afterWin: {
        n: afterWin.length,
        avg: avgSize(afterWin),
        ratio: ratio(avgSize(afterWin)),
        tradeIds: afterWin.map((t) => t.id),
      },
    },
    reentry: {
      medianMinutesAfterLoss: median(
        afterLoss.map((t) => t.minutesSincePrevClose!).filter((x) => x !== null),
      ),
      nAfterLoss: afterLoss.length,
      medianMinutesAfterWin: median(afterWin.map((t) => t.minutesSincePrevClose!).filter((x) => x !== null)),
      nAfterWin: afterWin.length,
    },
    tradesPerDay: {
      distribution: [...dist].sort((a, b) => a[0] - b[0]).map(([trades, d]) => ({ trades, days: d })),
      days: days.size,
      overMaxDays,
      overMaxTradeIds: overMaxDays.flatMap((d) => days.get(d)!.map((t) => t.id)),
    },
    overrides: {
      n: ov.length,
      rate: et.length ? ov.length / et.length : null,
      overridden: groupStat('overridden', ov),
      notOverridden: groupStat(
        'not overridden',
        et.filter((t) => !t.overrideFlag),
      ),
      byKind,
    },
    soonAfterLoss: {
      minutes: ctx.cooldownMinutes,
      within: groupStat('within', within),
      others: groupStat(
        'others',
        et.filter((t) => !withinIds.has(t.id)),
      ),
    },
    stopAfterLosses: {
      rule: ctx.stopAfterLosses,
      daysReached,
      daysContinued,
      compliance: daysReached ? 1 - daysContinued / daysReached : null,
      tradesAfterRule: groupStat('after rule', afterRule),
    },
    labels: {
      labelled: certain.length,
      uncertain: uncertainN,
      byDriver,
      planAdherence: {
        n: adherenceKnown.length,
        rate: adherenceKnown.length
          ? adherenceKnown.filter((t) => t.noteLabels!.followed_own_plan.p >= 0.65).length /
            adherenceKnown.length
          : null,
      },
      driverAfterLoss: share(afterLoss),
      driverAfterWin: share(afterWin),
    },
  };

  return {
    version: PROFILE_VERSION,
    tradeCount: et.length,
    metrics,
    conditionalProbs,
    pools: {
      plan: planT.map((t) => t.rMultiple!),
      tilt: tiltT.map((t) => t.rMultiple!),
      planIds: planT.map((t) => t.id),
      tiltIds: tiltT.map((t) => t.id),
      tradesPerDay: plannedPerDay,
    },
    insights: buildInsights(metrics),
  };
}

const fmtR = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const DRIVER_WORD: Record<string, string> = {
  revenge: 'revenge',
  fomo: 'FOMO',
  greed: 'greed',
  boredom: 'boredom',
  fear: 'fear',
  plan: 'following your plan',
};

/** Plain-language, calm-coach insights. Only statements with n ≥ MIN_N. */
export function buildInsights(m: BehaviourProfile['metrics']): Insight[] {
  const out: Insight[] = [];
  const s = m.soonAfterLoss;
  if (s.within.nR >= MIN_N && s.others.nR >= MIN_N && s.within.avgR !== null && s.others.avgR !== null) {
    const diff = s.within.avgR - s.others.avgR;
    out.push({
      id: 'soon_after_loss',
      text: `Trades taken within ${s.minutes} min of a loss: ${s.within.n}, average ${fmtR(s.within.avgR)} vs ${fmtR(s.others.avgR)} for your other trades.`,
      n: s.within.n,
      tone: diff < -0.1 ? 'caution' : diff > 0.1 ? 'positive' : 'neutral',
      tradeIds: s.within.tradeIds,
    });
  }
  for (const d of m.labels.byDriver) {
    if (d.key === 'plan' || d.key === 'unclear' || d.n < MIN_N) continue;
    out.push({
      id: `driver_${d.key}`,
      text: `Trades where your own note read as ${DRIVER_WORD[d.key] ?? d.key}: ${d.n}, net ${fmtR(d.netR)}.`,
      n: d.n,
      tone: d.netR < 0 ? 'caution' : 'neutral',
      tradeIds: d.tradeIds,
    });
  }
  const sz = m.sizing;
  if (sz.afterLoss.n >= MIN_N && sz.afterLoss.ratio !== null && sz.afterLoss.ratio >= 1.15) {
    out.push({
      id: 'size_after_loss',
      text: `After a loss your next trade averages ${sz.afterLoss.ratio.toFixed(2)}× your usual ${sz.basis === 'risk' ? 'risk' : 'size'} (n=${sz.afterLoss.n}).`,
      n: sz.afterLoss.n,
      tone: 'caution',
      tradeIds: sz.afterLoss.tradeIds,
    });
  }
  const o = m.overrides;
  if (
    o.overridden.nR >= MIN_N &&
    o.notOverridden.nR >= MIN_N &&
    o.overridden.avgR !== null &&
    o.notOverridden.avgR !== null
  ) {
    out.push({
      id: 'overrides',
      text: `Trades where you changed the plan mid-trade: ${o.overridden.n} (${pct(o.rate ?? 0)}), average ${fmtR(o.overridden.avgR)} vs ${fmtR(o.notOverridden.avgR)} when you left it alone.`,
      n: o.overridden.n,
      tone: o.overridden.avgR < o.notOverridden.avgR ? 'caution' : 'positive',
      tradeIds: o.overridden.tradeIds,
    });
  }
  const st = m.stopAfterLosses;
  if (st.rule && st.daysReached >= 3 && st.tradesAfterRule.n > 0) {
    out.push({
      id: 'stop_rule',
      text: `You hit your stop-after-${st.rule}-losses rule on ${st.daysReached} days and kept trading on ${st.daysContinued}; those later trades netted ${fmtR(st.tradesAfterRule.netR)}.`,
      n: st.tradesAfterRule.n,
      tone: st.tradesAfterRule.netR < 0 ? 'caution' : 'neutral',
      tradeIds: st.tradesAfterRule.tradeIds,
    });
  }
  const tagged = m.bySetup.filter((g) => g.key !== 'Untagged' && g.nR >= MIN_N && g.avgR !== null);
  const best = tagged.sort((a, b) => b.avgR! - a.avgR!)[0];
  if (best && tagged.length >= 2 && best.avgR! > 0) {
    out.push({
      id: 'best_setup',
      text: `Your strongest setup so far is “${best.key}”: ${best.n} trades, average ${fmtR(best.avgR!)}.`,
      n: best.n,
      tone: 'positive',
      tradeIds: best.tradeIds,
    });
  }
  return out;
}
