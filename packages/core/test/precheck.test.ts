import { describe, expect, it } from 'vitest';
import {
  buildComputed,
  decideVerdict,
  evaluateAccount,
  groupStat,
  pointValue,
  precheckInputSchema,
  ruleSchema,
  sizePosition,
  todayStats,
  traderRulesSchema,
  type PrecheckJevView,
} from '../src/index.js';

const pv = (() => {
  const r = pointValue('XAUUSD', 'USD');
  if (!r.ok) throw new Error();
  return r.value;
})();

describe('position sizing', () => {
  it('1% of 100k with a 10-point stop on XAUUSD = 1.00 lot', () => {
    const s = sizePosition({ entry: 2400, stop: 2390, target: 2420, riskPct: 1 }, 100_000, pv, 'USD');
    expect(s.positionSizeLots).toBe(1);
    expect(s.actualRisk).toBe(1000);
    expect(s.rewardRisk).toBe(2);
    expect(s.formula).toContain('rounded down');
  });
  it('rounds DOWN so risk never exceeds the chosen %', () => {
    const s = sizePosition({ entry: 2400, stop: 2393, target: null, riskPct: 1 }, 100_000, pv, 'USD');
    expect(s.positionSizeLots).toBe(1.42);
    expect(s.actualRisk).toBe(994);
    expect(s.actualRisk).toBeLessThanOrEqual(1000);
    expect(s.rewardRisk).toBeNull();
  });
  it('flags a size that rounds to zero', () => {
    const s = sizePosition({ entry: 2400, stop: 1400, target: null, riskPct: 0.05 }, 10_000, pv, 'USD');
    expect(s.tooSmall).toBe(true);
  });
  it('validates stop side', () => {
    const base = {
      accountId: '00000000-0000-4000-8000-000000000000',
      direction: 'long',
      entry: 2400,
      stop: 2410,
      riskPct: 1,
      preNote: 'test note',
    };
    expect(precheckInputSchema.safeParse(base).success).toBe(false);
    expect(precheckInputSchema.safeParse({ ...base, stop: 2390 }).success).toBe(true);
    expect(precheckInputSchema.safeParse({ ...base, stop: 2390, preNote: '' }).success).toBe(false);
  });
});

const rules = ruleSchema.parse({
  profitTargetPct: 10,
  maxDailyLossPct: 5,
  dailyLossBasis: 'start_of_day_balance',
  maxLossPct: 10,
  maxLossType: 'static',
  minTradingDays: 0,
  maxCalendarDays: null,
  dayResetTimezone: 'UTC',
  consistencyRulePct: null,
});
const tr = traderRulesSchema.parse({
  riskPct: 1,
  maxTradesPerDay: 3,
  stopAfterLosses: 2,
  cooldownMinutes: 30,
});
const now = new Date('2026-07-02T15:00:00Z');
const input = precheckInputSchema.parse({
  accountId: '00000000-0000-4000-8000-000000000000',
  direction: 'long',
  entry: 2400,
  stop: 2390,
  riskPct: 1,
  preNote: 'London breakout retest',
});
const noJev: PrecheckJevView = { status: 'ok' };

function scenario(
  trades: { openedAt: string; closedAt: string; pnl: number }[],
  o: { jev?: PrecheckJevView; riskPct?: number; historyR?: number[] } = {},
) {
  const inp = { ...input, riskPct: o.riskPct ?? 1 };
  const e0 = evaluateAccount(rules, 100_000, trades, null, { asOf: now });
  const sizing = sizePosition(inp, e0.balance, pv, 'USD');
  const e = evaluateAccount(rules, 100_000, trades, sizing.actualRisk, { asOf: now });
  const hist = o.historyR
    ? groupStat(
        'h',
        o.historyR.map((r, i) => ({
          id: `h${i}`,
          openedAt: now,
          closedAt: now,
          pnl: r * 1000,
          rMultiple: r,
          sizeLots: 1,
          riskAmount: 1000,
          setupTag: 'A',
          exitType: 'stop' as const,
          overrideFlag: false,
          overrideKind: null,
          noteLabels: null,
        })),
      )
    : null;
  const c = buildComputed({
    input: inp,
    evaluation: e,
    sizing,
    today: todayStats(trades, 'UTC', now),
    traderRules: tr,
    session: 'ny',
    history: hist,
    baselineRisk: 1000,
  });
  return decideVerdict(c, o.jev ?? noJev, 'USD');
}
const t = (h: number, pnl: number) => ({
  openedAt: `2026-07-02T${String(h).padStart(2, '0')}:00:00Z`,
  closedAt: `2026-07-02T${String(h).padStart(2, '0')}:20:00Z`,
  pnl,
});

describe('verdict', () => {
  it('go when nothing flags', () => {
    const v = scenario([]);
    expect(v.verdict).toBe('go');
    expect(v.reasons[0]!.code).toBe('clear');
  });
  it('stop when risk exceeds the remaining daily budget', () => {
    const v = scenario([t(8, -4500)]);
    expect(v.verdict).toBe('stop');
    expect(v.reasons.map((r) => r.code)).toContain('daily_budget');
  });
  it('stop after N losses in a row today', () => {
    const v = scenario([t(8, -500), t(9, -500)]);
    expect(v.verdict).toBe('stop');
    expect(v.reasons.map((r) => r.code)).toContain('stop_after_losses');
  });
  it('stop when max trades reached', () => {
    const v = scenario([t(8, 500), t(9, 500), t(10, -100)]);
    expect(v.reasons.map((r) => r.code)).toContain('max_trades');
    expect(v.verdict).toBe('stop');
  });
  it('stop on confident high tilt; not on unconfident high tilt', () => {
    const hi = scenario([], {
      jev: { status: 'ok', tilt_risk: { value: 'High', score: 2, confidence: 0.8, uncertain: false } },
    });
    expect(hi.verdict).toBe('stop');
    const unsure = scenario([], {
      jev: { status: 'ok', tilt_risk: { value: 'High', score: 2, confidence: 0.5, uncertain: true } },
    });
    expect(unsure.verdict).toBe('go');
  });
  it('caution on elevated tilt or likely impulse', () => {
    expect(
      scenario([], {
        jev: { status: 'ok', tilt_risk: { value: 'Elevated', score: 1, confidence: 0.7, uncertain: false } },
      }).verdict,
    ).toBe('caution');
    expect(
      scenario([], { jev: { status: 'ok', likely_impulse: { p: 0.65, uncertain: false } } }).verdict,
    ).toBe('caution');
    expect(
      scenario([], { jev: { status: 'ok', likely_impulse: { p: 0.64, uncertain: true } } }).verdict,
    ).toBe('go');
  });
  it('caution when size is above baseline', () => {
    const v = scenario([], { riskPct: 2 });
    expect(v.verdict).toBe('caution');
    expect(v.reasons.map((r) => r.code)).toContain('size_up');
  });
  it('caution when setup × session history is negative with n ≥ 10 only', () => {
    expect(scenario([], { historyR: Array(10).fill(-0.2) }).verdict).toBe('caution');
    expect(scenario([], { historyR: Array(9).fill(-0.2) }).verdict).toBe('go');
  });
  it('caution soon after a loss', () => {
    const v = scenario([{ openedAt: '2026-07-02T14:00:00Z', closedAt: '2026-07-02T14:45:00Z', pnl: -200 }]);
    expect(v.reasons.map((r) => r.code)).toContain('soon_after_loss');
    expect(v.verdict).toBe('caution');
  });
  it('a failed tilt check never changes the verdict silently', () => {
    const v = scenario([], { jev: { status: 'failed' } });
    expect(v.verdict).toBe('go');
    expect(v.reasons.map((r) => r.code)).toContain('jev_failed');
  });
  it('reasons never talk about market direction', () => {
    const v = scenario([t(8, -500), t(9, -500)], {
      jev: { status: 'ok', tilt_risk: { value: 'High', score: 2, confidence: 0.9, uncertain: false } },
    });
    for (const r of v.reasons)
      expect(r.text).not.toMatch(/bullish|bearish|will (go|rise|fall)|profitable|good trade|bad trade/i);
  });
});
