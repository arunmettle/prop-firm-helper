import { gteCents, ltCents, round2, toCents } from '../money.js';
import type { RuleName, Rules } from './schema.js';

/**
 * Incremental prop-rule state machine. It knows nothing about time zones or dates: callers feed it
 * day boundaries (`startDay`) and closed P&L (`applyClosedTrade`). `evaluateAccount` (real history)
 * and the Monte Carlo simulator both drive this same engine, so rules are implemented exactly once.
 *
 * Conventions (see docs/DECISIONS.md):
 *  - A breach happens when equity goes strictly BELOW a floor (compared in cents). Exactly at the floor is allowed.
 *  - The profit target is reached at balance >= target (cents).
 *  - When equity falls through both floors at once, the higher floor (the one crossed first) is reported.
 */

export interface Breach {
  rule: RuleName;
  /** Caller-supplied label for when it happened (ISO timestamp for real data, "day N" in the simulator). */
  at: string;
  dayIndex: number;
  /** Equity level that crossed the floor. */
  equity: number;
  floor: number;
}

export interface EngineSnapshot {
  balance: number;
  startingBalance: number;
  dayIndex: number | null;
  dayStartReference: number;
  dailyLossLimit: number;
  dailyFloor: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  highWaterMark: number;
  maxLossFloor: number;
  distanceToMaxLoss: number;
  profitTargetAmount: number;
  profitTargetBalance: number;
  /** (balance - start) / target amount. 1 = target reached. Can be negative. */
  profitProgress: number;
  tradingDays: number;
  bestDayProfit: number;
  consistencyOk: boolean;
  breached: Breach | null;
  passed: boolean;
  passedAt: string | null;
  timedOut: boolean;
  status: 'in_progress' | 'passed' | 'breached' | 'timed_out';
}

export interface ClosedTradeInput {
  pnl: number;
  /**
   * Worst intraday P&L of this trade before it closed (<= 0), e.g. -risk for a losing trade that ran to its
   * stop, or the recorded MAE. Used to check floors pessimistically. Defaults to min(pnl, 0).
   */
  worstPnl?: number;
  label: string;
}

export class RuleEngine {
  readonly rules: Rules;
  readonly startingBalance: number;
  balance: number;
  private dayIndex: number | null = null;
  private dayStartRef: number;
  private hwm: number;
  private tradingDayIds = new Set<string | number>();
  private dayPnl = new Map<number, number>();
  breached: Breach | null = null;
  passed = false;
  passedAt: string | null = null;
  timedOut = false;

  constructor(rules: Rules, startingBalance: number) {
    if (!(startingBalance > 0)) throw new Error('startingBalance must be > 0');
    this.rules = rules;
    this.startingBalance = startingBalance;
    this.balance = startingBalance;
    this.dayStartRef = startingBalance;
    this.hwm = startingBalance;
  }

  get terminal(): boolean {
    return this.breached !== null || this.passed || this.timedOut;
  }

  /**
   * Begin day `dayIndex` (0 = first day of the evaluation, counting calendar days).
   * `dayStartEquity` may be passed when floating P&L at the reset is known; it only matters for the
   * `start_of_day_equity_or_balance_higher` basis.
   */
  startDay(dayIndex: number, opts: { dayStartEquity?: number } = {}): void {
    if (this.dayIndex !== null && dayIndex < this.dayIndex) throw new Error('Days must be started in order');
    if (this.dayIndex === dayIndex) return;
    if (this.dayIndex !== null) this.endDay();
    this.dayIndex = dayIndex;
    const equity = opts.dayStartEquity ?? this.balance;
    this.dayStartRef =
      this.rules.dailyLossBasis === 'start_of_day_equity_or_balance_higher'
        ? Math.max(this.balance, equity)
        : this.balance;
    const max = this.rules.maxCalendarDays;
    if (max !== null && dayIndex + 1 > max && !this.terminal) this.timedOut = true;
  }

  private endDay(): void {
    if (this.rules.maxLossType === 'trailing_eod') this.hwm = Math.max(this.hwm, this.balance);
  }

  /** Count the current day as a trading day (call when a trade is opened). */
  markTradingDay(): void {
    if (this.dayIndex === null) throw new Error('startDay() first');
    if (!this.terminal) this.tradingDayIds.add(this.dayIndex);
  }

  get dailyLossLimit(): number {
    const base = this.rules.dailyLossAmountBasis === 'day_start' ? this.dayStartRef : this.startingBalance;
    return (base * this.rules.maxDailyLossPct) / 100;
  }

  get dailyFloor(): number {
    return this.dayStartRef - this.dailyLossLimit;
  }

  get maxLossFloor(): number {
    const amount = (this.startingBalance * this.rules.maxLossPct) / 100;
    if (this.rules.maxLossType === 'static') return this.startingBalance - amount;
    const trailing = this.hwm - amount;
    return this.rules.trailingLockAt === 'starting_balance' ? Math.min(trailing, this.startingBalance) : trailing;
  }

  get profitTargetBalance(): number {
    return this.startingBalance * (1 + this.rules.profitTargetPct / 100);
  }

  private bestDayProfit(): number {
    let best = 0;
    for (const v of this.dayPnl.values()) best = Math.max(best, v);
    return best;
  }

  private consistencyOk(): boolean {
    const pct = this.rules.consistencyRulePct;
    if (pct === null) return true;
    const total = this.balance - this.startingBalance;
    if (total <= 0) return true;
    return toCents(this.bestDayProfit()) <= toCents((total * pct) / 100);
  }

  /** Check equity against floors; returns the breach if any. Does not change balance. */
  private checkFloors(equity: number, label: string): Breach | null {
    if (this.dayIndex === null) throw new Error('startDay() first');
    const daily = this.dailyFloor;
    const total = this.maxLossFloor;
    const dailyHit = ltCents(equity, daily);
    const totalHit = ltCents(equity, total);
    if (!dailyHit && !totalHit) return null;
    // Both crossed: report the higher floor (crossed first as equity falls). Ties → max_loss (the harder rule).
    const useDaily = dailyHit && (!totalHit || toCents(daily) > toCents(total));
    return {
      rule: useDaily ? 'max_daily_loss' : 'max_loss',
      at: label,
      dayIndex: this.dayIndex,
      equity: round2(equity),
      floor: round2(useDaily ? daily : total),
    };
  }

  applyClosedTrade(t: ClosedTradeInput): void {
    if (this.dayIndex === null) throw new Error('startDay() first');
    if (this.terminal) {
      // Evaluation is over; keep the running balance for display only.
      this.balance += t.pnl;
      return;
    }
    const worst = Math.min(0, t.pnl, t.worstPnl ?? 0);
    const breachIntraday = this.checkFloors(this.balance + worst, t.label);
    this.balance += t.pnl;
    this.dayPnl.set(this.dayIndex, (this.dayPnl.get(this.dayIndex) ?? 0) + t.pnl);
    if (breachIntraday) {
      this.breached = breachIntraday;
      return;
    }
    const breachClose = this.checkFloors(this.balance, t.label);
    if (breachClose) {
      this.breached = breachClose;
      return;
    }
    if (this.rules.maxLossType === 'trailing_intraday') this.hwm = Math.max(this.hwm, this.balance);
    this.checkPass(t.label);
  }

  private checkPass(label: string): void {
    if (this.terminal) return;
    if (!gteCents(this.balance, this.profitTargetBalance)) return;
    if (this.tradingDayIds.size < this.rules.minTradingDays) return;
    if (!this.consistencyOk()) return;
    this.passed = true;
    this.passedAt = label;
  }

  snapshot(): EngineSnapshot {
    const targetAmount = (this.startingBalance * this.rules.profitTargetPct) / 100;
    const dailyFloor = this.dailyFloor;
    const maxLossFloor = this.maxLossFloor;
    return {
      balance: round2(this.balance),
      startingBalance: this.startingBalance,
      dayIndex: this.dayIndex,
      dayStartReference: round2(this.dayStartRef),
      dailyLossLimit: round2(this.dailyLossLimit),
      dailyFloor: round2(dailyFloor),
      dailyLossUsed: round2(Math.max(0, this.dayStartRef - this.balance)),
      dailyLossRemaining: round2(Math.max(0, this.balance - dailyFloor)),
      highWaterMark: round2(this.hwm),
      maxLossFloor: round2(maxLossFloor),
      distanceToMaxLoss: round2(Math.max(0, this.balance - maxLossFloor)),
      profitTargetAmount: round2(targetAmount),
      profitTargetBalance: round2(this.profitTargetBalance),
      profitProgress: (this.balance - this.startingBalance) / targetAmount,
      tradingDays: this.tradingDayIds.size,
      bestDayProfit: round2(this.bestDayProfit()),
      consistencyOk: this.consistencyOk(),
      breached: this.breached,
      passed: this.passed,
      passedAt: this.passedAt,
      timedOut: this.timedOut,
      status: this.breached ? 'breached' : this.passed ? 'passed' : this.timedOut ? 'timed_out' : 'in_progress',
    };
  }
}
