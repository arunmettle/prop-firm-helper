import { describe, expect, it } from 'vitest';
import { buildProfile, groupStat, type BTrade, type BehaviourContext } from '../src/index.js';
import type { NoteLabels } from '../src/jev/labels.js';

const ctx: BehaviourContext = {
  timezone: 'UTC',
  startingBalance: 100_000,
  dailyLossLimit: 5000,
  maxTradesPerDay: 3,
  stopAfterLosses: 2,
  cooldownMinutes: 30,
};

let id = 0;
const T = (open: string, minutes: number, r: number, o: Partial<BTrade> = {}): BTrade => {
  const risk = o.riskAmount ?? 1000;
  return {
    id: `t${++id}`,
    openedAt: open,
    closedAt: new Date(new Date(open).getTime() + minutes * 60_000).toISOString(),
    pnl: r * risk,
    rMultiple: r,
    sizeLots: 1,
    riskAmount: risk,
    setupTag: 'A',
    exitType: r > 0 ? 'target' : 'stop',
    overrideFlag: false,
    overrideKind: null,
    noteLabels: null,
    ...o,
  };
};

const labels = (driver: string, tilt: number, uncertain = false): NoteLabels => ({
  version: 'x',
  primary_driver: { value: driver, confidence: uncertain ? 0.4 : 0.9, uncertain },
  followed_own_plan: { p: driver === 'plan' ? 0.9 : 0.1, uncertain: false },
  impulsiveness: { value: 'x', score: 0, confidence: 0.9, uncertain: false },
  tilt_behaviour: { p: tilt, uncertain: false },
});

describe('group stats', () => {
  it('computes win rate, avg R, net R and P&L', () => {
    const g = groupStat('x', [T('2026-07-01T08:00:00Z', 10, 2), T('2026-07-01T09:00:00Z', 10, -1), T('2026-07-01T10:00:00Z', 10, 0.5)]);
    expect(g.n).toBe(3);
    expect(g.winRate).toBeCloseTo(2 / 3);
    expect(g.avgR).toBeCloseTo(0.5);
    expect(g.netR).toBeCloseTo(1.5);
    expect(g.netPnl).toBe(1500);
  });
  it('trades without R count toward n and P&L but not avg R', () => {
    const g = groupStat('x', [T('2026-07-01T08:00:00Z', 10, 1), { ...T('2026-07-01T09:00:00Z', 10, 1), rMultiple: null }]);
    expect(g.n).toBe(2);
    expect(g.nR).toBe(1);
  });
});

describe('behaviour profile', () => {
  // Each day: a loss at 08:00, a quick doubled-size re-entry 10 min later (loses), then a planned trade later (wins).
  const history: BTrade[] = [];
  for (let d = 1; d <= 12; d++) {
    const day = `2026-07-${String(d).padStart(2, '0')}`;
    history.push(T(`${day}T08:00:00Z`, 20, -1, { noteLabels: labels('plan', 0.1) }));
    history.push(T(`${day}T08:30:00Z`, 20, -1, { riskAmount: 2000, sizeLots: 2, noteLabels: labels('revenge', 0.9) }));
    history.push(T(`${day}T13:00:00Z`, 60, 2, { setupTag: 'B', noteLabels: labels('plan', 0.1) }));
  }
  const p = buildProfile(history, ctx);
  const m = p.metrics;

  it('overall stats', () => {
    expect(m.overall.n).toBe(36);
    expect(m.overall.winRate).toBeCloseTo(1 / 3);
    expect(m.overall.avgR).toBeCloseTo(0);
  });

  it('by setup, session and weekday carry sample sizes', () => {
    expect(m.bySetup.find((g) => g.key === 'B')?.n).toBe(12);
    expect(m.bySession.find((g) => g.key === 'london')?.n).toBe(24);
    expect(m.bySession.find((g) => g.key === 'ny')?.n).toBe(12);
    expect(m.byWeekday.reduce((s, g) => s + g.n, 0)).toBe(36);
  });

  it('size after a loss vs baseline', () => {
    // baseline (median risk) = 1000; trades right after a loss are the 2000-risk re-entries and the 13:00 trades.
    expect(m.sizing.basis).toBe('risk');
    expect(m.sizing.baseline).toBe(1000);
    expect(m.sizing.afterLoss.ratio).toBeCloseTo(1.5);
  });

  it('median minutes to next trade after a loss vs after a win', () => {
    expect(m.reentry.medianMinutesAfterLoss).toBeGreaterThan(0);
    // after a win the next trade is the next day at 08:00 (18h later)
    expect(m.reentry.medianMinutesAfterWin).toBe(18 * 60); // win closes 14:00, next trade 08:00 next day
  });

  it('soon-after-loss performance', () => {
    expect(m.soonAfterLoss.within.n).toBe(12);
    expect(m.soonAfterLoss.within.avgR).toBe(-1);
  });

  it('stop-after-N compliance', () => {
    expect(m.stopAfterLosses.daysReached).toBe(12);
    expect(m.stopAfterLosses.daysContinued).toBe(12);
    expect(m.stopAfterLosses.compliance).toBe(0);
    expect(m.stopAfterLosses.tradesAfterRule.netR).toBe(24);
  });

  it('label aggregates by driver', () => {
    const rev = m.labels.byDriver.find((g) => g.key === 'revenge')!;
    expect(rev.n).toBe(12);
    expect(rev.netR).toBe(-12);
    expect(m.labels.planAdherence.rate).toBeCloseTo(24 / 36);
  });

  it('pools split plan vs tilt R using labels', () => {
    expect(p.pools.tilt).toHaveLength(12);
    expect(p.pools.plan).toHaveLength(24);
    expect(p.pools.tradesPerDay.every((n) => n === 2)).toBe(true);
  });

  it('insights are plain sentences with sample sizes', () => {
    const ids = p.insights.map((i) => i.id);
    expect(ids).toContain('soon_after_loss');
    expect(ids).toContain('driver_revenge');
    expect(ids).toContain('size_after_loss');
    const rev = p.insights.find((i) => i.id === 'driver_revenge')!;
    expect(rev.text).toBe('Trades where your own note read as revenge: 12, net −12.0R.');
    expect(rev.tradeIds).toHaveLength(12);
  });

  it('conditional probabilities: size-up concentrated after 1 loss', () => {
    const b = p.conditionalProbs.buckets.find((x) => x.losses === '1' && x.band === 'down_lt50')!;
    expect(b.n).toBe(12);
    expect(b.raw.sizeUp).toBe(1);
    expect(b.lowData).toBe(false);
    const calm = p.conditionalProbs.buckets.find((x) => x.losses === '0' && x.band === 'flat')!;
    expect(calm.raw.sizeUp).toBe(0);
    expect(p.conditionalProbs.classification.jev).toBe(36);
  });

  it('sparse buckets are blended with neighbours and flagged', () => {
    const b = p.conditionalProbs.buckets.find((x) => x.losses === '3+' && x.band === 'up')!;
    expect(b.n).toBe(0);
    expect(b.lowData).toBe(true);
    expect(b.smoothed.sizeUp).toBeGreaterThanOrEqual(0);
    expect(b.smoothed.sizeUp).toBeLessThanOrEqual(1);
  });

  it('days over max trades are listed', () => {
    const p2 = buildProfile(history, { ...ctx, maxTradesPerDay: 2 });
    expect(p2.metrics.tradesPerDay.overMaxDays).toHaveLength(12);
  });
});

describe('heuristic classification without labels', () => {
  it('falls back to transparent heuristics and says so', () => {
    const h: BTrade[] = [];
    for (let d = 1; d <= 5; d++) {
      const day = `2026-07-0${d}`;
      h.push(T(`${day}T08:00:00Z`, 10, -1));
      h.push(T(`${day}T08:15:00Z`, 10, -1, { riskAmount: 2000 }));
    }
    const p = buildProfile(h, ctx);
    expect(p.conditionalProbs.classification.heuristic).toBe(10);
    expect(p.pools.tilt.length).toBe(5);
  });

  it('skipped valid setups come from unlinked go/caution prechecks', () => {
    const h = [T('2026-07-01T08:00:00Z', 10, 1)];
    const p = buildProfile(h, ctx, [
      { createdAt: '2026-07-01T09:00:00Z', verdict: 'go', linked: false },
      { createdAt: '2026-07-01T09:30:00Z', verdict: 'stop', linked: false },
    ]);
    const b = p.conditionalProbs.buckets.find((x) => x.losses === '0' && x.band === 'up')!;
    expect(b.counts.skipValid).toBe(1);
  });
});
