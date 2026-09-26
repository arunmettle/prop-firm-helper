import { z } from 'zod';
import { isValidTimeZone } from '../time.js';

export const dailyLossBasisSchema = z.enum(['start_of_day_balance', 'start_of_day_equity_or_balance_higher']);
export const maxLossTypeSchema = z.enum(['static', 'trailing_eod', 'trailing_intraday']);

export const ruleSchema = z.object({
  /** % of starting balance that must be gained. */
  profitTargetPct: z.number().positive().max(1000),
  /** Daily loss limit as % (of `dailyLossAmountBasis`). */
  maxDailyLossPct: z.number().positive().max(100),
  /** Reference level the daily loss is measured from. */
  dailyLossBasis: dailyLossBasisSchema,
  /**
   * Extension (see DECISIONS.md): what the daily % is a percentage OF.
   * `initial_balance` = FTMO-style fixed amount; `day_start` = % of that day's reference level.
   */
  dailyLossAmountBasis: z.enum(['initial_balance', 'day_start']).default('initial_balance'),
  maxLossPct: z.number().positive().max(100),
  maxLossType: maxLossTypeSchema,
  /**
   * Extension: where a trailing floor stops trailing. `starting_balance` = floor never rises above the starting
   * balance (common for trailing drawdown firms). `never` = keeps trailing.
   */
  trailingLockAt: z.enum(['starting_balance', 'never']).default('starting_balance'),
  minTradingDays: z.number().int().min(0).max(365),
  maxCalendarDays: z.number().int().positive().max(3650).nullable(),
  dayResetTimezone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone'),
  /** Best single day's profit may not exceed this % of total profit (null = no rule). */
  consistencyRulePct: z.number().positive().max(100).nullable(),
});

export type Rules = z.infer<typeof ruleSchema>;
export type RulesInput = z.input<typeof ruleSchema>;

export type RuleName = 'max_daily_loss' | 'max_loss' | 'max_calendar_days';
