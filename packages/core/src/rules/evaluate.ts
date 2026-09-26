import { round2 } from '../money.js';
import { dayDiff, dayKey } from '../time.js';
import { RuleEngine, type EngineSnapshot } from './engine.js';
import type { Rules } from './schema.js';

export interface EvalTrade {
  openedAt: Date | string;
  closedAt: Date | string;
  pnl: number;
}

export interface EvaluateOptions {
  /** "Now" — rolls the engine forward so today's daily budget is fresh. Defaults to the last event. */
  asOf?: Date | string;
  /** First day of the evaluation (for calendar-day limits). Defaults to the first trade's open day. */
  startDate?: Date | string;
}

export interface AccountEvaluation extends EngineSnapshot {
  /** Day key (firm time zone) the snapshot refers to. */
  currentDay: string | null;
  /** Risk of the planned/open trade, if given. */
  openTradeRisk: number | null;
  /** True if `openTradeRisk` would take equity below today's daily floor. */
  openTradeExceedsDaily: boolean;
  /** True if `openTradeRisk` would take equity below the max-loss floor. */
  openTradeExceedsMaxLoss: boolean;
  /** Daily loss budget left after the open trade's full risk (never negative). */
  dailyLossRemainingAfterOpen: number;
  calendarDaysElapsed: number;
}

interface Ev {
  t: number;
  kind: 0 | 1; // 0 = open, 1 = close (opens sort first on ties)
  pnl: number;
  label: string;
}

/**
 * Evaluate an account's closed-trade history against its rules.
 * Pure: same input → same output. Day boundaries use `rules.dayResetTimezone`.
 * P&L counts on the day the trade CLOSED; the trading day counts on the day it OPENED.
 */
export function evaluateAccount(
  rules: Rules,
  startingBalance: number,
  closedTrades: EvalTrade[],
  openTradeRisk?: number | null,
  opts: EvaluateOptions = {},
): AccountEvaluation {
  const tz = rules.dayResetTimezone;
  const events: Ev[] = [];
  for (const tr of closedTrades) {
    const o = new Date(tr.openedAt).getTime();
    const c = new Date(tr.closedAt).getTime();
    if (Number.isNaN(o) || Number.isNaN(c)) throw new Error('Invalid trade timestamp');
    if (c < o) throw new Error('Trade closes before it opens');
    if (!Number.isFinite(tr.pnl)) throw new Error('Trade pnl must be a finite number');
    events.push({ t: o, kind: 0, pnl: 0, label: new Date(o).toISOString() });
    events.push({ t: c, kind: 1, pnl: tr.pnl, label: new Date(c).toISOString() });
  }
  events.sort((a, b) => a.t - b.t || a.kind - b.kind);

  const engine = new RuleEngine(rules, startingBalance);
  const firstKey = opts.startDate
    ? dayKey(opts.startDate, tz)
    : events[0]
      ? dayKey(events[0].t, tz)
      : opts.asOf
        ? dayKey(opts.asOf, tz)
        : null;

  let currentKey: string | null = null;
  const roll = (key: string) => {
    if (key === currentKey) return;
    if (firstKey === null) throw new Error('unreachable');
    engine.startDay(Math.max(0, dayDiff(firstKey, key)));
    currentKey = key;
  };

  for (const ev of events) {
    roll(dayKey(ev.t, tz));
    if (ev.kind === 0) engine.markTradingDay();
    else engine.applyClosedTrade({ pnl: ev.pnl, label: ev.label });
  }
  if (opts.asOf) {
    const k = dayKey(opts.asOf, tz);
    const cur = currentKey as string | null; // assigned inside roll()
    if (cur === null || k > cur) roll(k);
  }

  const snap = engine.snapshot();
  const risk = openTradeRisk != null && openTradeRisk > 0 ? openTradeRisk : null;
  const after = risk === null ? snap.dailyLossRemaining : Math.max(0, snap.dailyLossRemaining - risk);
  return {
    ...snap,
    currentDay: currentKey,
    openTradeRisk: risk,
    openTradeExceedsDaily: risk !== null && Math.round(risk * 100) > Math.round(snap.dailyLossRemaining * 100),
    openTradeExceedsMaxLoss: risk !== null && Math.round(risk * 100) > Math.round(snap.distanceToMaxLoss * 100),
    dailyLossRemainingAfterOpen: round2(after),
    calendarDaysElapsed: firstKey && currentKey ? dayDiff(firstKey, currentKey as string) + 1 : 0,
  };
}
