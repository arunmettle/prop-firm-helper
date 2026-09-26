import { dayKey } from '../time.js';
import type { BTrade, BehaviourContext, LossBucket, PnlBand } from './types.js';

export interface EnrichedTrade extends BTrade {
  open: number;
  close: number;
  day: string;
  /** Losing closes in a row before this trade opened (across days). */
  streakBefore: number;
  /** Realised P&L of the day (firm tz) before this trade opened. */
  dayPnlBefore: number;
  /** 0-based index of this trade among trades opened that day. */
  indexToday: number;
  minutesSinceLoss: number | null;
  minutesSincePrevClose: number | null;
  prevOutcome: 'win' | 'loss' | 'flat' | null;
  size: number;
  losses: LossBucket;
  band: PnlBand;
}

export const lossBucket = (n: number): LossBucket => (n >= 3 ? '3+' : (String(n) as LossBucket));

export function pnlBand(dayPnl: number, dailyLossLimit: number, startingBalance: number): PnlBand {
  const flatEps = startingBalance * 0.001;
  if (dayPnl > flatEps) return 'up';
  if (dayPnl >= -flatEps) return 'flat';
  return -dayPnl < dailyLossLimit * 0.5 ? 'down_lt50' : 'down_ge50';
}

/** Sort, then compute the state each trade was taken in. Pure. */
export function enrich(trades: BTrade[], ctx: BehaviourContext, sizeBasis: 'risk' | 'lots'): EnrichedTrade[] {
  const ts = trades
    .map((t) => ({ ...t, open: new Date(t.openedAt).getTime(), close: new Date(t.closedAt).getTime() }))
    .sort((a, b) => a.open - b.open || a.close - b.close);
  const byClose = [...ts].sort((a, b) => a.close - b.close);
  const out: EnrichedTrade[] = [];
  const perDayCount = new Map<string, number>();
  for (const t of ts) {
    const day = dayKey(t.open, ctx.timezone);
    const prior = byClose.filter((p) => p.close <= t.open && p.id !== t.id);
    let streak = 0;
    for (let i = prior.length - 1; i >= 0; i--) {
      if (prior[i]!.pnl < 0) streak++;
      else break;
    }
    const dayPnlBefore = prior
      .filter((p) => dayKey(p.close, ctx.timezone) === day)
      .reduce((s, p) => s + p.pnl, 0);
    const lastLoss = [...prior].reverse().find((p) => p.pnl < 0);
    const prev = prior.at(-1);
    const idx = perDayCount.get(day) ?? 0;
    perDayCount.set(day, idx + 1);
    out.push({
      ...t,
      day,
      streakBefore: streak,
      dayPnlBefore,
      indexToday: idx,
      minutesSinceLoss: lastLoss ? (t.open - lastLoss.close) / 60_000 : null,
      minutesSincePrevClose: prev ? (t.open - prev.close) / 60_000 : null,
      prevOutcome: prev ? (prev.pnl > 0 ? 'win' : prev.pnl < 0 ? 'loss' : 'flat') : null,
      size: sizeBasis === 'risk' ? (t.riskAmount ?? 0) : t.sizeLots,
      losses: lossBucket(streak),
      band: pnlBand(dayPnlBefore, ctx.dailyLossLimit, ctx.startingBalance),
    });
  }
  return out;
}

export interface TradeBehaviour {
  tilt: boolean;
  source: 'jev' | 'heuristic';
  sizeUp: boolean;
  extraTrade: boolean;
  earlyClose: boolean;
  widenStop: boolean;
}

const TILT_DRIVERS = new Set(['fomo', 'revenge', 'greed', 'boredom']);

/**
 * Decide whether a historical trade was plan vs tilt, and which behaviours it shows.
 * Jev labels decide when present and certain; otherwise transparent heuristics are used (and counted as such).
 */
export function classifyBehaviour(
  t: EnrichedTrade,
  ctx: BehaviourContext,
  baseline: number | null,
): TradeBehaviour {
  const soonAfterLoss = t.minutesSinceLoss !== null && t.minutesSinceLoss <= ctx.cooldownMinutes;
  const beyondMax = ctx.maxTradesPerDay !== null && t.indexToday >= ctx.maxTradesPerDay;
  const bigger = baseline !== null && baseline > 0 && t.size > 1.3 * baseline;
  const l = t.noteLabels;
  const justified =
    l?.override_justified && !l.override_justified.uncertain && l.override_justified.p >= 0.65;
  let tilt: boolean;
  let source: 'jev' | 'heuristic';
  if (l && !l.tilt_behaviour.uncertain) {
    tilt = l.tilt_behaviour.p >= 0.65;
    source = 'jev';
  } else {
    tilt =
      (soonAfterLoss && t.streakBefore > 0) ||
      beyondMax ||
      (bigger && t.streakBefore > 0) ||
      (t.overrideFlag &&
        !justified &&
        (t.overrideKind === 'moved_stop' ||
          t.overrideKind === 'removed_stop' ||
          t.overrideKind === 'added_size'));
    source = 'heuristic';
  }
  const driver = l && !l.primary_driver.uncertain ? l.primary_driver.value : null;
  const earlyClose =
    (t.overrideKind === 'closed_early' && !justified) || (t.exitType === 'manual_close' && driver === 'fear');
  const widenStop = (t.overrideKind === 'moved_stop' || t.overrideKind === 'removed_stop') && !justified;
  return {
    tilt,
    source,
    sizeUp: tilt && bigger,
    extraTrade:
      tilt &&
      (beyondMax || soonAfterLoss || (driver !== null && TILT_DRIVERS.has(driver) && driver !== 'greed')),
    earlyClose,
    widenStop,
  };
}
