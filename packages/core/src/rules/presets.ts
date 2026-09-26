import type { Rules } from './schema.js';

export interface RulePreset {
  id: string;
  label: string;
  note: string;
  rules: Rules;
}

const VERIFY = 'Example preset — verify against your firm’s current rules before relying on it.';

/**
 * Presets are plain data. They are EXAMPLES modelled on common evaluation structures, not official rules of any firm.
 */
export const RULE_PRESETS: RulePreset[] = [
  {
    id: 'two_step_static',
    label: 'Two-step style, static drawdown (example)',
    note: VERIFY,
    rules: {
      profitTargetPct: 10,
      maxDailyLossPct: 5,
      dailyLossBasis: 'start_of_day_equity_or_balance_higher',
      dailyLossAmountBasis: 'initial_balance',
      maxLossPct: 10,
      maxLossType: 'static',
      trailingLockAt: 'starting_balance',
      minTradingDays: 4,
      maxCalendarDays: null,
      dayResetTimezone: 'Europe/Prague',
      consistencyRulePct: null,
    },
  },
  {
    id: 'one_step_trailing_eod',
    label: 'One-step style, trailing end-of-day drawdown (example)',
    note: VERIFY,
    rules: {
      profitTargetPct: 10,
      maxDailyLossPct: 3,
      dailyLossBasis: 'start_of_day_balance',
      dailyLossAmountBasis: 'initial_balance',
      maxLossPct: 6,
      maxLossType: 'trailing_eod',
      trailingLockAt: 'starting_balance',
      minTradingDays: 3,
      maxCalendarDays: null,
      dayResetTimezone: 'America/New_York',
      consistencyRulePct: 50,
    },
  },
  {
    id: 'time_limited_intraday',
    label: 'Time-limited, trailing intraday drawdown (example)',
    note: VERIFY,
    rules: {
      profitTargetPct: 8,
      maxDailyLossPct: 4,
      dailyLossBasis: 'start_of_day_balance',
      dailyLossAmountBasis: 'day_start',
      maxLossPct: 8,
      maxLossType: 'trailing_intraday',
      trailingLockAt: 'starting_balance',
      minTradingDays: 5,
      maxCalendarDays: 30,
      dayResetTimezone: 'UTC',
      consistencyRulePct: null,
    },
  },
];

export const presetById = (id: string | null | undefined): RulePreset | undefined =>
  RULE_PRESETS.find((p) => p.id === id);
