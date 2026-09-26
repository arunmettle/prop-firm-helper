import { describe, expect, it } from 'vitest';
import {
  evaluateAccount,
  RuleEngine,
  ruleSchema,
  RULE_PRESETS,
  type Rules,
  type EvalTrade,
} from '../src/rules/index.js';
import { dayDiff, dayKey, weekdayOfKey } from '../src/time.js';

const S = 100_000;
const base = (o: Partial<Rules> = {}): Rules =>
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

/** Trade opened at `day`T`hh`:00Z and closed 30 minutes later. `day` is a 1-based day of July 2026. */
const tr = (day: number, pnl: number, hh = 10): EvalTrade => {
  const d = String(day).padStart(2, '0');
  const h = String(hh).padStart(2, '0');
  return { openedAt: `2026-07-${d}T${h}:00:00Z`, closedAt: `2026-07-${d}T${h}:30:00Z`, pnl };
};

describe('time helpers', () => {
  it('dayKey respects the firm time zone', () => {
    expect(dayKey('2026-07-01T22:30:00Z', 'UTC')).toBe('2026-07-01');
    expect(dayKey('2026-07-01T22:30:00Z', 'Europe/Prague')).toBe('2026-07-02');
    expect(dayKey('2026-07-01T03:00:00Z', 'America/New_York')).toBe('2026-06-30');
  });
  it('dayKey handles the DST switch in New York', () => {
    // 2026-03-08 is the US spring-forward day. 04:59Z = 23:59 EST on Mar 7; 05:00Z = 00:00 EST Mar 8.
    expect(dayKey('2026-03-08T04:59:00Z', 'America/New_York')).toBe('2026-03-07');
    expect(dayKey('2026-03-08T05:00:00Z', 'America/New_York')).toBe('2026-03-08');
  });
  it('dayDiff and weekday', () => {
    expect(dayDiff('2026-02-27', '2026-03-02')).toBe(3);
    expect(dayDiff('2026-07-01', '2026-07-01')).toBe(0);
    expect(weekdayOfKey('2026-07-06')).toBe(1);
    expect(weekdayOfKey('2026-07-05')).toBe(7);
  });
});

describe('schema + presets', () => {
  it('rejects an unknown time zone', () => {
    expect(() => base({ dayResetTimezone: 'Mars/Olympus' })).toThrow();
  });
  it('applies defaults for extension fields', () => {
    const r = base();
    expect(r.dailyLossAmountBasis).toBe('initial_balance');
    expect(r.trailingLockAt).toBe('starting_balance');
  });
  it('all presets validate and are labelled as examples', () => {
    for (const p of RULE_PRESETS) {
      expect(() => ruleSchema.parse(p.rules)).not.toThrow();
      expect(p.label.toLowerCase()).toContain('example');
      expect(p.note.toLowerCase()).toContain('verify');
    }
  });
});

describe('empty + profit target', () => {
  it('no trades → in progress with full budgets', () => {
    const r = evaluateAccount(base(), S, []);
    expect(r.status).toBe('in_progress');
    expect(r.balance).toBe(S);
    expect(r.dailyLossRemaining).toBe(5000);
    expect(r.maxLossFloor).toBe(90_000);
    expect(r.distanceToMaxLoss).toBe(10_000);
    expect(r.tradingDays).toBe(0);
  });
  it('exactly reaching the profit target passes', () => {
    const r = evaluateAccount(base(), S, [tr(1, 4000), tr(2, 6000)]);
    expect(r.passed).toBe(true);
    expect(r.passedAt).toBe('2026-07-02T10:30:00.000Z');
    expect(r.profitProgress).toBeCloseTo(1);
  });
  it('one cent short of the target does not pass', () => {
    const r = evaluateAccount(base(), S, [tr(1, 9999.99)]);
    expect(r.passed).toBe(false);
    expect(r.status).toBe('in_progress');
  });
  it('profit progress is a fraction of the target amount', () => {
    const r = evaluateAccount(base(), S, [tr(1, 2500)]);
    expect(r.profitProgress).toBeCloseTo(0.25);
    expect(r.profitTargetBalance).toBe(110_000);
  });
});

describe('daily loss (balance basis, initial-balance amount)', () => {
  it('losing exactly the daily limit is not a breach', () => {
    const r = evaluateAccount(base(), S, [tr(1, -5000)]);
    expect(r.breached).toBeNull();
    expect(r.dailyLossRemaining).toBe(0);
    expect(r.dailyLossUsed).toBe(5000);
  });
  it('one cent over the daily limit breaches', () => {
    const r = evaluateAccount(base(), S, [tr(1, -5000.01)]);
    expect(r.breached?.rule).toBe('max_daily_loss');
    expect(r.breached?.floor).toBe(95_000);
    expect(r.status).toBe('breached');
  });
  it('losses accumulate within a day and report the breaching trade', () => {
    const r = evaluateAccount(base(), S, [tr(1, -3000, 9), tr(1, -2500, 11)]);
    expect(r.breached?.rule).toBe('max_daily_loss');
    expect(r.breached?.at).toBe('2026-07-01T11:30:00.000Z');
  });
  it('the daily budget resets the next day', () => {
    const r = evaluateAccount(base(), S, [tr(1, -4000), tr(2, -4000)]);
    expect(r.breached).toBeNull();
    expect(r.balance).toBe(92_000);
    expect(r.dailyLossUsed).toBe(4000);
    expect(r.dailyLossRemaining).toBe(1000);
  });
  it('a winning day followed by a breach: the floor is measured from the new day start', () => {
    const r = evaluateAccount(base(), S, [tr(1, 3000), tr(2, -5000.01)]);
    expect(r.breached?.rule).toBe('max_daily_loss');
    expect(r.breached?.floor).toBe(98_000);
  });
  it('intraday profit does not raise the daily floor (balance basis)', () => {
    const ok = evaluateAccount(base(), S, [tr(1, 2000, 9), tr(1, -6999, 11)]);
    expect(ok.breached).toBeNull();
    expect(ok.dailyFloor).toBe(95_000);
    const bad = evaluateAccount(base(), S, [tr(1, 2000, 9), tr(1, -7000.01, 11)]);
    expect(bad.breached?.rule).toBe('max_daily_loss');
  });
  it('day_start amount basis scales the limit with the day start balance', () => {
    const rules = base({ dailyLossAmountBasis: 'day_start' });
    const r = evaluateAccount(rules, S, [tr(1, 10_000 - 0.01), tr(2, -5499)], null, {});
    // day 2 starts at 109,999.99 → limit 5,499.9995 → floor ≈ 104,499.99
    expect(r.breached).toBeNull();
    expect(r.dailyLossLimit).toBeCloseTo(5500, 1);
  });
  it('equity-or-balance-higher uses equity when it is higher', () => {
    const e = new RuleEngine(base({ dailyLossBasis: 'start_of_day_equity_or_balance_higher' }), S);
    e.startDay(0, { dayStartEquity: 102_000 });
    expect(e.snapshot().dayStartReference).toBe(102_000);
    expect(e.snapshot().dailyFloor).toBe(97_000);
  });
  it('equity-or-balance-higher uses balance when equity is lower', () => {
    const e = new RuleEngine(base({ dailyLossBasis: 'start_of_day_equity_or_balance_higher' }), S);
    e.startDay(0, { dayStartEquity: 98_000 });
    expect(e.snapshot().dayStartReference).toBe(S);
  });
  it('balance basis ignores a higher start-of-day equity', () => {
    const e = new RuleEngine(base(), S);
    e.startDay(0, { dayStartEquity: 102_000 });
    expect(e.snapshot().dayStartReference).toBe(S);
  });
  it('float drift does not create a false breach', () => {
    const r = evaluateAccount(base(), S, [tr(1, -1666.666, 8), tr(1, -1666.666, 9), tr(1, -1666.666, 10)]);
    expect(r.breached).toBeNull();
  });
});

describe('time zones and midnight', () => {
  const lateLoss = { openedAt: '2026-07-01T20:00:00Z', closedAt: '2026-07-01T20:30:00Z', pnl: -4000 };
  const spanning = { openedAt: '2026-07-01T21:30:00Z', closedAt: '2026-07-01T22:30:00Z', pnl: -4000 };
  it('in UTC both losses are the same day → breach', () => {
    const r = evaluateAccount(base(), S, [lateLoss, spanning]);
    expect(r.breached?.rule).toBe('max_daily_loss');
  });
  it('in Prague the second trade closes after midnight → separate days, no breach', () => {
    const r = evaluateAccount(base({ dayResetTimezone: 'Europe/Prague' }), S, [lateLoss, spanning]);
    expect(r.breached).toBeNull();
    expect(r.currentDay).toBe('2026-07-02');
  });
  it('a trade spanning midnight counts its trading day on the open day and P&L on the close day', () => {
    const r = evaluateAccount(base({ dayResetTimezone: 'Europe/Prague' }), S, [spanning]);
    expect(r.tradingDays).toBe(1);
    expect(r.dailyLossUsed).toBe(4000); // P&L is on July 2 (current day)
    expect(r.currentDay).toBe('2026-07-02');
  });
  it('an event exactly at midnight belongs to the new day', () => {
    const r = evaluateAccount(base(), S, [
      { openedAt: '2026-07-01T10:00:00Z', closedAt: '2026-07-01T23:59:59Z', pnl: -4000 },
      { openedAt: '2026-07-02T00:00:00Z', closedAt: '2026-07-02T00:00:00Z', pnl: -4000 },
    ]);
    expect(r.breached).toBeNull();
    expect(r.tradingDays).toBe(2);
  });
  it('asOf on a later day refreshes the daily budget', () => {
    const r = evaluateAccount(base(), S, [tr(1, -4000)], null, { asOf: '2026-07-02T08:00:00Z' });
    expect(r.dailyLossUsed).toBe(0);
    expect(r.dailyLossRemaining).toBe(5000);
    expect(r.currentDay).toBe('2026-07-02');
  });
});

describe('max loss: static', () => {
  it('breaches one cent below the static floor', () => {
    const r = evaluateAccount(base(), S, [tr(1, -4000), tr(2, -4000), tr(3, -2000.01)]);
    expect(r.breached?.rule).toBe('max_loss');
    expect(r.breached?.floor).toBe(90_000);
  });
  it('exactly at the static floor is not a breach', () => {
    const r = evaluateAccount(base(), S, [tr(1, -4000), tr(2, -4000), tr(3, -2000)]);
    expect(r.breached).toBeNull();
    expect(r.distanceToMaxLoss).toBe(0);
  });
  it('static floor does not move with profit', () => {
    const r = evaluateAccount(base({ profitTargetPct: 50 }), S, [tr(1, 5000), tr(2, 5000)]);
    expect(r.maxLossFloor).toBe(90_000);
  });
  it('when both floors are crossed at once the higher floor is reported', () => {
    const r = evaluateAccount(base({ maxLossPct: 4 }), S, [tr(1, -6000)]);
    expect(r.breached?.rule).toBe('max_loss');
    expect(r.breached?.floor).toBe(96_000);
  });
});

describe('max loss: trailing end-of-day', () => {
  const eod = (o: Partial<Rules> = {}) => base({ maxLossType: 'trailing_eod', maxDailyLossPct: 20, ...o });
  it('floor does not move intraday', () => {
    const r = evaluateAccount(eod(), S, [tr(1, 3000)]);
    expect(r.maxLossFloor).toBe(90_000);
  });
  it('floor trails the end-of-day high-water mark from the next day', () => {
    const r = evaluateAccount(eod(), S, [tr(1, 3000)], null, { asOf: '2026-07-02T09:00:00Z' });
    expect(r.highWaterMark).toBe(103_000);
    expect(r.maxLossFloor).toBe(93_000);
  });
  it('the high-water mark never decreases', () => {
    const r = evaluateAccount(eod(), S, [tr(1, 4000), tr(2, -3000)], null, { asOf: '2026-07-03T09:00:00Z' });
    expect(r.highWaterMark).toBe(104_000);
    expect(r.maxLossFloor).toBe(94_000);
  });
  it('breaches against the trailed floor', () => {
    const r = evaluateAccount(eod(), S, [tr(1, 4000), tr(2, -3000), tr(3, -7000.01)]);
    expect(r.breached?.rule).toBe('max_loss');
    expect(r.breached?.floor).toBe(94_000);
  });
  it('exactly at the trailed floor is not a breach', () => {
    const r = evaluateAccount(eod(), S, [tr(1, 4000), tr(2, -3000), tr(3, -7000)]);
    expect(r.breached).toBeNull();
  });
  it('floor locks at the starting balance', () => {
    const r = evaluateAccount(eod({ profitTargetPct: 30 }), S, [tr(1, 8000), tr(2, 7000)], null, {
      asOf: '2026-07-03T09:00:00Z',
    });
    expect(r.highWaterMark).toBe(115_000);
    expect(r.maxLossFloor).toBe(S);
  });
  it('with lock "never" the floor keeps trailing', () => {
    const r = evaluateAccount(
      eod({ profitTargetPct: 30, trailingLockAt: 'never' }),
      S,
      [tr(1, 8000), tr(2, 7000)],
      null,
      {
        asOf: '2026-07-03T09:00:00Z',
      },
    );
    expect(r.maxLossFloor).toBe(105_000);
  });
  it('locked floor still breaches when balance drops below the starting balance', () => {
    const r = evaluateAccount(eod({ profitTargetPct: 30 }), S, [tr(1, 12_000), tr(2, -12_000.01)]);
    expect(r.breached?.rule).toBe('max_loss');
    expect(r.breached?.floor).toBe(S);
  });
});

describe('max loss: trailing intraday', () => {
  const intra = (o: Partial<Rules> = {}) =>
    base({ maxLossType: 'trailing_intraday', maxDailyLossPct: 20, ...o });
  it('floor trails immediately after a winning trade', () => {
    const r = evaluateAccount(intra(), S, [tr(1, 4000)]);
    expect(r.maxLossFloor).toBe(94_000);
  });
  it('breach on the same day after a new peak', () => {
    const r = evaluateAccount(intra(), S, [tr(1, 4000, 9), tr(1, -10_000.01, 11)]);
    expect(r.breached?.rule).toBe('max_loss');
    expect(r.breached?.floor).toBe(94_000);
  });
  it('trailing intraday floor locks at starting balance', () => {
    const r = evaluateAccount(intra({ profitTargetPct: 30 }), S, [tr(1, 14_000)]);
    expect(r.maxLossFloor).toBe(S);
  });
});

describe('min trading days', () => {
  it('target reached early does not pass until min days are met', () => {
    const rules = base({ minTradingDays: 4 });
    const early = evaluateAccount(rules, S, [tr(1, 6000), tr(2, 5000)]);
    expect(early.passed).toBe(false);
    expect(early.tradingDays).toBe(2);
    const later = evaluateAccount(rules, S, [tr(1, 6000), tr(2, 5000), tr(3, 10), tr(4, 10)]);
    expect(later.passed).toBe(true);
    expect(later.passedAt).toBe('2026-07-04T10:30:00.000Z');
  });
  it('min days met but target not reached → not passed', () => {
    const r = evaluateAccount(base({ minTradingDays: 2 }), S, [tr(1, 100), tr(2, 100), tr(3, 100)]);
    expect(r.passed).toBe(false);
  });
  it('multiple trades on one day count as one trading day', () => {
    const r = evaluateAccount(base(), S, [tr(1, 10, 8), tr(1, 10, 9), tr(1, 10, 10)]);
    expect(r.tradingDays).toBe(1);
  });
});

describe('consistency rule', () => {
  const c = base({ consistencyRulePct: 50 });
  it('blocks a pass when one day dominates profit', () => {
    const r = evaluateAccount(c, S, [tr(1, 8000), tr(2, 2000)]);
    expect(r.passed).toBe(false);
    expect(r.consistencyOk).toBe(false);
    expect(r.bestDayProfit).toBe(8000);
  });
  it('passes once the best day is at most the limit (equality allowed)', () => {
    const r = evaluateAccount(c, S, [tr(1, 8000), tr(2, 2000), tr(3, 6000)]);
    expect(r.passed).toBe(true);
  });
  it('null consistency rule never blocks', () => {
    const r = evaluateAccount(base(), S, [tr(1, 10_000)]);
    expect(r.passed).toBe(true);
  });
});

describe('calendar-day limit', () => {
  it('a trade on day 31 of a 30-day window times out', () => {
    const r = evaluateAccount(base({ maxCalendarDays: 30 }), S, [tr(1, 100), { ...tr(31, 20_000) }]);
    expect(r.timedOut).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.status).toBe('timed_out');
  });
  it('reaching the target on day 30 passes', () => {
    const r = evaluateAccount(base({ maxCalendarDays: 30 }), S, [tr(1, 100), tr(30, 9900)]);
    expect(r.passed).toBe(true);
    expect(r.calendarDaysElapsed).toBe(30);
  });
  it('asOf past the window times out an idle account', () => {
    const r = evaluateAccount(base({ maxCalendarDays: 5 }), S, [tr(1, 100)], null, {
      asOf: '2026-07-10T09:00:00Z',
    });
    expect(r.status).toBe('timed_out');
  });
  it('startDate option anchors the window', () => {
    const r = evaluateAccount(base({ maxCalendarDays: 5 }), S, [tr(10, 100)], null, {
      startDate: '2026-07-01T00:00:00Z',
    });
    expect(r.timedOut).toBe(true);
  });
});

describe('terminal states', () => {
  it('profits after a breach do not un-breach', () => {
    const r = evaluateAccount(base(), S, [tr(1, -5001), tr(2, 20_000)]);
    expect(r.status).toBe('breached');
    expect(r.passed).toBe(false);
    expect(r.balance).toBe(114_999);
  });
  it('losses after passing do not breach', () => {
    const r = evaluateAccount(base(), S, [tr(1, 10_000), tr(2, -9000)]);
    expect(r.status).toBe('passed');
    expect(r.breached).toBeNull();
  });
});

describe('open trade risk', () => {
  it('flags a risk above the remaining daily budget', () => {
    const r = evaluateAccount(base(), S, [tr(1, -3000)], 2000.01);
    expect(r.openTradeExceedsDaily).toBe(true);
    expect(r.dailyLossRemainingAfterOpen).toBe(0);
  });
  it('risk exactly equal to the remaining budget is allowed', () => {
    const r = evaluateAccount(base(), S, [tr(1, -3000)], 2000);
    expect(r.openTradeExceedsDaily).toBe(false);
    expect(r.dailyLossRemainingAfterOpen).toBe(0);
  });
  it('reports remaining budget after risk and max-loss exposure', () => {
    const r = evaluateAccount(base({ maxDailyLossPct: 20 }), S, [tr(1, -9000)], 1500);
    expect(r.dailyLossRemainingAfterOpen).toBe(9500);
    expect(r.openTradeExceedsMaxLoss).toBe(true);
  });
});

describe('engine: pessimistic intraday checks', () => {
  it('a trade closing at a small loss but with a deep worst point breaches', () => {
    const e = new RuleEngine(base(), S);
    e.startDay(0);
    e.markTradingDay();
    e.applyClosedTrade({ pnl: -1000, worstPnl: -6000, label: 'd0' });
    expect(e.breached?.rule).toBe('max_daily_loss');
  });
  it('a winning trade with a deep drawdown breaches first', () => {
    const e = new RuleEngine(base(), S);
    e.startDay(0);
    e.applyClosedTrade({ pnl: 500, worstPnl: -5500, label: 'd0' });
    expect(e.breached?.rule).toBe('max_daily_loss');
  });
  it('rejects out-of-order days and requires startDay', () => {
    const e = new RuleEngine(base(), S);
    expect(() => e.applyClosedTrade({ pnl: 1, label: 'x' })).toThrow();
    e.startDay(3);
    expect(() => e.startDay(2)).toThrow();
  });
});

describe('input validation', () => {
  it('rejects a trade that closes before it opens', () => {
    expect(() =>
      evaluateAccount(base(), S, [
        { openedAt: '2026-07-02T00:00:00Z', closedAt: '2026-07-01T00:00:00Z', pnl: 1 },
      ]),
    ).toThrow();
  });
  it('rejects a non-finite pnl', () => {
    expect(() => evaluateAccount(base(), S, [tr(1, Number.NaN)])).toThrow();
  });
  it('rejects a non-positive starting balance', () => {
    expect(() => evaluateAccount(base(), 0, [])).toThrow();
  });
});
