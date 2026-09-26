import { dayKey } from '../time.js';

export interface MinimalTrade {
  openedAt: Date | string;
  closedAt: Date | string | null;
  pnl: number | null;
}

export interface TodayStats {
  day: string;
  tradesToday: number;
  closedToday: number;
  /** Consecutive losing closes today, counting back from the most recent close. */
  consecutiveLossesToday: number;
  /** Consecutive losing closes overall (across days). */
  consecutiveLosses: number;
  pnlToday: number;
  lastLossAt: string | null;
  minutesSinceLastLoss: number | null;
}

export function todayStats(trades: MinimalTrade[], tz: string, now: Date = new Date()): TodayStats {
  const today = dayKey(now, tz);
  const closed = trades
    .filter((t) => t.closedAt && t.pnl !== null && new Date(t.closedAt) <= now)
    .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());
  const closedToday = closed.filter((t) => dayKey(t.closedAt!, tz) === today);
  const count = (list: MinimalTrade[]) => {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if ((list[i]!.pnl ?? 0) < 0) n++;
      else break;
    }
    return n;
  };
  const lastLoss = [...closed].reverse().find((t) => (t.pnl ?? 0) < 0);
  const lastLossAt = lastLoss ? new Date(lastLoss.closedAt!).toISOString() : null;
  return {
    day: today,
    tradesToday: trades.filter((t) => dayKey(t.openedAt, tz) === today).length,
    closedToday: closedToday.length,
    consecutiveLossesToday: count(closedToday),
    consecutiveLosses: count(closed),
    pnlToday: closedToday.reduce((s, t) => s + (t.pnl ?? 0), 0),
    lastLossAt,
    minutesSinceLastLoss: lastLossAt ? Math.floor((now.getTime() - new Date(lastLossAt).getTime()) / 60_000) : null,
  };
}
