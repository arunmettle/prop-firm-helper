import { describe, expect, it } from 'vitest';
import { computeTradeMath, pointValue, suggestExitType, todayStats, tradeInputSchema } from '../src/index.js';

const base = {
  instrument: 'XAUUSD',
  direction: 'long' as const,
  sizeLots: 0.5,
  entryPrice: 2400,
  stopPrice: 2390,
  exitPrice: 2420,
  closedAt: '2026-07-01T12:00:00Z',
  pnl: null,
};

describe('trade math', () => {
  it('XAUUSD long: risk, pnl and R', () => {
    const m = computeTradeMath(base, 'USD');
    expect(m.riskAmount).toBe(500); // 10 × 0.5 × 100
    expect(m.pnl).toBe(1000); // 20 × 0.5 × 100
    expect(m.rMultiple).toBe(2);
  });
  it('short trade signs are correct', () => {
    const m = computeTradeMath({ ...base, direction: 'short', stopPrice: 2410, exitPrice: 2405 }, 'USD');
    expect(m.riskAmount).toBe(500);
    expect(m.pnl).toBe(-250);
    expect(m.rMultiple).toBe(-0.5);
  });
  it('manual pnl overrides price-based pnl', () => {
    const m = computeTradeMath({ ...base, pnl: 950.5 }, 'USD');
    expect(m.pnl).toBe(950.5);
    expect(m.rMultiple).toBeCloseTo(1.901, 3);
  });
  it('no stop → no risk and no R, with a warning', () => {
    const m = computeTradeMath({ ...base, stopPrice: null }, 'USD');
    expect(m.riskAmount).toBeNull();
    expect(m.rMultiple).toBeNull();
    expect(m.warnings.join()).toMatch(/No stop/);
  });
  it('open trade has no pnl', () => {
    const m = computeTradeMath({ ...base, closedAt: null, exitPrice: null }, 'USD');
    expect(m.pnl).toBeNull();
    expect(m.riskAmount).toBe(500);
  });
  it('currency mismatch refuses to guess', () => {
    const r = pointValue('XAUUSD', 'EUR');
    expect(r.ok).toBe(false);
    const m = computeTradeMath(base, 'EUR');
    expect(m.pnl).toBeNull();
    expect(m.riskAmount).toBeNull();
  });
  it('user override of point value applies', () => {
    const m = computeTradeMath(base, 'EUR', { XAUUSD: { valuePerPoint: 92 } });
    expect(m.riskAmount).toBe(460);
  });
  it('contract size override applies', () => {
    const r = pointValue('xau/usd', 'USD', { XAUUSD: { contractSize: 10 } });
    expect(r.ok && r.value.valuePerPoint).toBe(10);
  });
  it('unknown instrument requires an override', () => {
    expect(pointValue('BTCUSD', 'USD').ok).toBe(false);
  });
  it('suggests exit type from prices', () => {
    const t = { direction: 'long' as const, entryPrice: 100, stopPrice: 90, targetPrice: 120, closedAt: 'x' };
    expect(suggestExitType({ ...t, exitPrice: 120 })).toBe('target');
    expect(suggestExitType({ ...t, exitPrice: 90 })).toBe('stop');
    expect(suggestExitType({ ...t, exitPrice: 100 })).toBe('breakeven');
    expect(suggestExitType({ ...t, exitPrice: 105 })).toBe('manual_close');
    expect(suggestExitType({ ...t, exitPrice: null })).toBe('open');
  });
});

describe('trade input validation', () => {
  const ok = {
    accountId: '00000000-0000-4000-8000-000000000000',
    direction: 'long',
    sizeLots: 1,
    entryPrice: 2400,
    stopPrice: 2390,
    openedAt: '2026-07-01T10:00:00Z',
  };
  it('accepts a minimal open trade with defaults', () => {
    const t = tradeInputSchema.parse(ok);
    expect(t.instrument).toBe('XAUUSD');
    expect(t.exitType).toBe('open');
  });
  it('rejects a stop on the wrong side', () => {
    expect(tradeInputSchema.safeParse({ ...ok, stopPrice: 2410 }).success).toBe(false);
    expect(tradeInputSchema.safeParse({ ...ok, direction: 'short', stopPrice: 2390 }).success).toBe(false);
  });
  it('rejects a closed trade without exit price or pnl', () => {
    const r = tradeInputSchema.safeParse({ ...ok, closedAt: '2026-07-01T11:00:00Z', exitType: 'manual_close' });
    expect(r.success).toBe(false);
  });
  it('rejects close before open', () => {
    const r = tradeInputSchema.safeParse({ ...ok, closedAt: '2026-07-01T09:00:00Z', exitPrice: 2401, exitType: 'manual_close' });
    expect(r.success).toBe(false);
  });
  it('requires an override kind when flagged', () => {
    expect(tradeInputSchema.safeParse({ ...ok, overrideFlag: true }).success).toBe(false);
  });
});

describe('today stats', () => {
  const now = new Date('2026-07-02T15:00:00Z');
  const t = (open: string, close: string | null, pnl: number | null) => ({ openedAt: open, closedAt: close, pnl });
  it('counts trades, losses in a row and time since last loss in the firm tz', () => {
    const s = todayStats(
      [
        t('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', -100),
        t('2026-07-02T09:00:00Z', '2026-07-02T09:30:00Z', 200),
        t('2026-07-02T10:00:00Z', '2026-07-02T10:30:00Z', -100),
        t('2026-07-02T11:00:00Z', '2026-07-02T14:00:00Z', -50),
        t('2026-07-02T14:30:00Z', null, null),
      ],
      'UTC',
      now,
    );
    expect(s.tradesToday).toBe(4);
    expect(s.consecutiveLossesToday).toBe(2);
    expect(s.pnlToday).toBe(50);
    expect(s.minutesSinceLastLoss).toBe(60);
  });
  it('losses from yesterday do not count as losses today', () => {
    const s = todayStats([t('2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', -100)], 'UTC', now);
    expect(s.consecutiveLossesToday).toBe(0);
    expect(s.consecutiveLosses).toBe(1);
  });
});
