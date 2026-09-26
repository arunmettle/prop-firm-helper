import { RULE_PRESETS } from '@cooldown/core';

export const accountBody = (o: Record<string, unknown> = {}) => ({
  label: 'Test 100k',
  firmPreset: 'two_step_static',
  startingBalance: 100_000,
  currency: 'USD',
  rules: { ...RULE_PRESETS[0]!.rules, dayResetTimezone: 'UTC' },
  traderRules: { riskPct: 1, maxTradesPerDay: 3, stopAfterLosses: 2, setups: ['London breakout retest'] },
  ...o,
});

let n = 0;
/** A closed XAUUSD long, 1 lot, entry 2400, stop 2390 (risk $1000). exit sets the outcome. */
export const tradeBody = (accountId: string, o: Record<string, unknown> = {}) => {
  n++;
  const open = new Date(Date.UTC(2026, 6, 1, 8, n * 3));
  const close = new Date(open.getTime() + 20 * 60_000);
  return {
    accountId,
    instrument: 'XAUUSD',
    direction: 'long',
    sizeLots: 1,
    entryPrice: 2400,
    stopPrice: 2390,
    targetPrice: 2420,
    openedAt: open.toISOString(),
    closedAt: close.toISOString(),
    exitPrice: 2420,
    exitType: 'target',
    setupTag: 'breakout',
    preNote: 'London breakout retest with clean structure',
    ...o,
  };
};
