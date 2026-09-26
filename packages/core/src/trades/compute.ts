import { round2, roundTo } from '../money.js';
import type { UserSettings } from '../settings.js';
import { pointValue } from './instruments.js';
import type { Direction, ExitType } from './schema.js';

export interface TradeMathInput {
  instrument: string;
  direction: Direction;
  sizeLots: number;
  entryPrice: number;
  stopPrice: number | null;
  exitPrice: number | null;
  closedAt: string | Date | null;
  pnl: number | null;
}

export interface TradeMath {
  riskAmount: number | null;
  pnl: number | null;
  rMultiple: number | null;
  /** Why a value couldn't be computed (shown to the user, never silently guessed). */
  warnings: string[];
  formula: string | null;
}

/**
 * risk_amount = |entry − stop| × lots × value-per-point
 * pnl         = (exit − entry) × direction × lots × value-per-point   (unless a manual P&L is given)
 * r_multiple  = pnl / risk_amount
 */
export function computeTradeMath(
  t: TradeMathInput,
  accountCurrency: string,
  overrides: UserSettings['instruments'] = {},
): TradeMath {
  const warnings: string[] = [];
  const pv = pointValue(t.instrument, accountCurrency, overrides);
  const dir = t.direction === 'long' ? 1 : -1;
  let riskAmount: number | null = null;
  let pnl: number | null = t.pnl;
  if (!pv.ok) warnings.push(pv.reason);
  if (pv.ok && t.stopPrice !== null) {
    riskAmount = round2(Math.abs(t.entryPrice - t.stopPrice) * t.sizeLots * pv.value.valuePerPoint);
  } else if (t.stopPrice === null) {
    warnings.push('No stop recorded — this trade has no defined risk, so no R-multiple.');
  }
  if (t.closedAt && pnl === null) {
    if (pv.ok && t.exitPrice !== null) {
      pnl = round2((t.exitPrice - t.entryPrice) * dir * t.sizeLots * pv.value.valuePerPoint);
    } else if (t.exitPrice !== null) {
      warnings.push('P&L could not be computed from prices — enter it manually.');
    }
  }
  if (pnl !== null) pnl = round2(pnl);
  const rMultiple =
    pnl !== null && riskAmount !== null && riskAmount > 0 ? roundTo(pnl / riskAmount, 4) : null;
  return { riskAmount, pnl, rMultiple, warnings, formula: pv.ok ? pv.value.formula : null };
}

/** Suggest an exit type from the prices (user can change it). */
export function suggestExitType(t: {
  direction: Direction;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  closedAt: unknown;
}): ExitType {
  if (!t.closedAt || t.exitPrice === null) return 'open';
  const eq = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);
  if (t.targetPrice !== null && eq(t.exitPrice, t.targetPrice)) return 'target';
  if (t.stopPrice !== null && eq(t.exitPrice, t.stopPrice)) return 'stop';
  if (eq(t.exitPrice, t.entryPrice)) return 'breakeven';
  return 'manual_close';
}
