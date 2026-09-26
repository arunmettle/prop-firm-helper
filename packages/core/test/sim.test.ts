import { describe, expect, it } from 'vitest';
import { ruleSchema, type BehaviourDim, type DimProbs } from '../src/index.js';
import { mulberry32, runSimulation, simulateScenario, wilson, type SimConfig } from '../src/sim/index.js';

const rules = (o: Record<string, unknown> = {}) =>
  ruleSchema.parse({
    profitTargetPct: 10,
    maxDailyLossPct: 5,
    dailyLossBasis: 'start_of_day_balance',
    maxLossPct: 10,
    maxLossType: 'static',
    minTradingDays: 0,
    maxCalendarDays: null,
    dayResetTimezone: 'UTC',
    consistencyRulePct: null,
    ...o,
  });

const emptyEvidence: Record<BehaviourDim, string[]> = { sizeUp: [], extraTrade: [], skipValid: [], earlyClose: [], widenStop: [] };
const cfg = (o: Partial<SimConfig> = {}, m: Partial<SimConfig['measured']> = {}): SimConfig => ({
  version: 'sim-v1',
  rules: rules(),
  startingBalance: 100_000,
  trader: { riskPct: 1, maxTradesPerDay: null, stopAfterLosses: null, tradingDaysPerWeek: 7 },
  runs: 200,
  seed: 42,
  maxDays: 60,
  measured: { probs: {}, planPool: [1], tiltPool: [-1], tradesPerDay: [1], sizeUpMultiple: 2, historyTrades: 100, evidence: emptyEvidence, ...m },
  ...o,
});
const params = (c: SimConfig, o: Record<string, unknown> = {}) => ({
  id: 's',
  label: 's',
  kind: 'measured' as const,
  probs: null,
  zero: new Set<BehaviourDim>(),
  planPool: c.measured.planPool,
  tiltPool: c.measured.tiltPool,
  tradesPerDay: c.measured.tradesPerDay,
  trader: c.trader,
  sizeUpMultiple: 2,
  ...o,
});

describe('rng + CI', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('Wilson interval', () => {
    const w = wilson(50, 100);
    expect(w.p).toBe(0.5);
    expect(w.lo).toBeCloseTo(0.4038, 3);
    expect(w.hi).toBeCloseTo(0.5962, 3);
    expect(wilson(0, 100).lo).toBe(0);
    expect(wilson(100, 100).hi).toBeCloseTo(1, 12);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 0 });
  });
});

describe('analytic toy histories', () => {
  it('always +1R passes, on day 10 (1.01^10 ≥ 1.10)', () => {
    const c = cfg();
    const r = simulateScenario(c, params(c));
    expect(r.pass.p).toBe(1);
    expect(r.medianPassDay).toBe(10);
  });
  it('min trading days delays the pass', () => {
    const c = cfg({ rules: rules({ minTradingDays: 12 }) });
    expect(simulateScenario(c, params(c)).medianPassDay).toBe(12);
  });
  it('always −1R at 5% risk breaches max loss on day 3', () => {
    // 100k → 95k → 90.25k → 85.74k: below the 90k floor on the 3rd loss; daily loss (≤ 5k) never exceeded.
    const c = cfg({ trader: { riskPct: 5, maxTradesPerDay: null, stopAfterLosses: null, tradingDaysPerWeek: 7 } }, { planPool: [-1] });
    const r = simulateScenario(c, params(c));
    expect(r.breach.p).toBe(1);
    expect(r.breachByRule.max_loss).toBe(c.runs);
    expect(r.breachByDay[2]).toBe(c.runs);
  });
  it('two −1R trades a day at 3% risk breach the daily limit on day 1', () => {
    const c = cfg({ trader: { riskPct: 3, maxTradesPerDay: null, stopAfterLosses: null, tradingDaysPerWeek: 7 } }, { planPool: [-1], tradesPerDay: [2] });
    const r = simulateScenario(c, params(c));
    expect(r.breachByRule.max_daily_loss).toBe(c.runs);
    expect(r.breachByDay[0]).toBe(c.runs);
  });
  it('stop-after-1-loss rule prevents that daily breach', () => {
    const c = cfg({ trader: { riskPct: 3, maxTradesPerDay: null, stopAfterLosses: 1, tradingDaysPerWeek: 7 } }, { planPool: [-1], tradesPerDay: [2] });
    const r = simulateScenario(c, params(c));
    expect(r.breachByRule.max_daily_loss).toBe(0);
    expect(r.breachByRule.max_loss).toBe(c.runs);
  });
  it('break-even trades time out at the horizon', () => {
    const c = cfg({}, { planPool: [0] });
    const r = simulateScenario(c, params(c));
    expect(r.timeout.p).toBe(1);
  });
  it('calendar limit from the rules is the horizon', () => {
    const c = cfg({ rules: rules({ maxCalendarDays: 5 }) });
    const r = simulateScenario(c, params(c));
    expect(r.timeout.p).toBe(1);
  });
  it('non-trading days are skipped (5 days/week → pass on calendar day 12)', () => {
    const c = cfg({ trader: { riskPct: 1, maxTradesPerDay: null, stopAfterLosses: null, tradingDaysPerWeek: 5 } });
    expect(simulateScenario(c, params(c)).medianPassDay).toBe(12);
  });
  it('intraday worst case: a small final loss still checks a full −1R dip', () => {
    // −0.2R closes but the path touches −1R; at 6% risk the dip breaches the 5% daily limit immediately.
    const c = cfg({ trader: { riskPct: 6, maxTradesPerDay: null, stopAfterLosses: null, tradingDaysPerWeek: 7 } }, { planPool: [-0.2] });
    const r = simulateScenario(c, params(c));
    expect(r.breachByRule.max_daily_loss).toBe(c.runs);
    expect(r.breachByDay[0]).toBe(c.runs);
  });
});

describe('trailing drawdown in the simulator', () => {
  it('trailing EOD breaches at least as often as static for the same trades', () => {
    const m = { planPool: [2, -1, -1, 1.5, -1, 2, -1], tradesPerDay: [1, 2] };
    const s = cfg({ runs: 2000 }, m);
    const t = cfg({ runs: 2000, rules: rules({ maxLossType: 'trailing_eod', maxLossPct: 6 }) }, m);
    const st = cfg({ runs: 2000, rules: rules({ maxLossPct: 6 }) }, m);
    const rs = simulateScenario(st, params(st));
    const rt = simulateScenario(t, params(t));
    expect(rt.breach.p).toBeGreaterThanOrEqual(rs.breach.p);
    expect(simulateScenario(s, params(s)).runs).toBe(2000);
  });
});

describe('behaviour + sensitivity', () => {
  const tiltProbs: Record<string, DimProbs> = {};
  for (const l of ['0', '1', '2', '3+']) for (const b of ['up', 'flat', 'down_lt50', 'down_ge50'])
    tiltProbs[`${l}|${b}`] = { sizeUp: l === '0' ? 0 : 0.6, extraTrade: l === '0' ? 0 : 0.4, skipValid: 0, earlyClose: 0.1, widenStop: 0 };
  const c = cfg({ runs: 1500 }, { probs: tiltProbs, planPool: [2, -1, -1, 2, 0.5], tiltPool: [-1, -1, 1], tradesPerDay: [1, 2], evidence: { ...emptyEvidence, sizeUp: ['t1', 't2'] } });

  it('is deterministic: same seed + config → identical result', () => {
    const a = runSimulation(c, () => 0);
    const b = runSimulation(c, () => 0);
    expect(a).toEqual(b);
  });
  it('a different seed gives a (slightly) different result', () => {
    const a = runSimulation(c, () => 0);
    const b = runSimulation({ ...c, seed: 43 }, () => 0);
    expect(a.scenarios[1]!.pass.p).not.toBe(b.scenarios[1]!.pass.p);
  });
  it('perfect discipline beats measured tilt behaviour, and removing a behaviour never hurts much', () => {
    const r = runSimulation(c);
    const perfect = r.scenarios.find((s) => s.id === 'perfect')!;
    const measured = r.scenarios.find((s) => s.id === 'measured')!;
    expect(perfect.pass.p).toBeGreaterThan(measured.pass.p);
    expect(r.ranking[0]!.dim).toBe('sizeUp');
    expect(r.ranking[0]!.sentence).toMatch(/^Not sizing up.*: \d+% → \d+%\.$/);
    expect(r.topEvidence).toEqual({ dim: 'sizeUp', tradeIds: ['t1', 't2'] });
    expect(r.ruleSweeps.length).toBeGreaterThan(0);
  });
  it('falls back to illustrative archetypes under 30 trades', () => {
    const r = runSimulation({ ...c, runs: 300, measured: { ...c.measured, historyTrades: 12 } });
    expect(r.illustrative).toBe(true);
    expect(r.scenarios.filter((s) => s.kind === 'archetype')).toHaveLength(3);
    expect(r.topEvidence).toBeNull();
  });
  it('rates always sum to 1 and CIs bracket the estimate', () => {
    const r = runSimulation(c);
    for (const s of r.scenarios) {
      expect(s.pass.p + s.breach.p + s.timeout.p).toBeCloseTo(1, 10);
      expect(s.pass.lo).toBeLessThanOrEqual(s.pass.p);
      expect(s.pass.hi).toBeGreaterThanOrEqual(s.pass.p);
    }
  });
});

describe('performance', () => {
  it('10,000 runs × all scenarios in under 20 seconds', () => {
    const probs: Record<string, DimProbs> = {};
    for (const l of ['0', '1', '2', '3+']) for (const b of ['up', 'flat', 'down_lt50', 'down_ge50'])
      probs[`${l}|${b}`] = { sizeUp: 0.2, extraTrade: 0.2, skipValid: 0.05, earlyClose: 0.1, widenStop: 0.05 };
    const c = cfg(
      { runs: 10_000, rules: rules({ minTradingDays: 4 }), trader: { riskPct: 0.5, maxTradesPerDay: 3, stopAfterLosses: 2, tradingDaysPerWeek: 5 } },
      { probs, planPool: [2, -1, -1, 1.5, -1, 0.5, 2, -1], tiltPool: [-1, -1, 1, -1.2], tradesPerDay: [1, 2, 2, 3] },
    );
    const t0 = performance.now();
    const r = runSimulation(c);
    const ms = performance.now() - t0;
    expect(r.scenarios.length).toBeGreaterThanOrEqual(10);
    expect(ms).toBeLessThan(20_000);
    console.info(`[perf] ${r.scenarios.length} scenarios × 10,000 runs in ${Math.round(ms)} ms`);
  }, 30_000);
});
