import { computeTradeMath, normalizeSymbol, parseUserSettings, type TradeInput } from '@cooldown/core';
import type { Account, NewTrade, Trade, User } from '../db/schema.js';

/** Build the DB row for a trade: computes risk_amount, pnl and r_multiple from the inputs. */
export function buildTradeRow(
  input: TradeInput,
  account: Account,
  user: User,
  source: 'manual' | 'csv' = 'manual',
) {
  const settings = parseUserSettings(user.settings);
  const math = computeTradeMath(
    {
      instrument: input.instrument,
      direction: input.direction,
      sizeLots: input.sizeLots,
      entryPrice: input.entryPrice,
      stopPrice: input.stopPrice,
      exitPrice: input.exitPrice,
      closedAt: input.closedAt,
      pnl: input.pnl,
    },
    account.currency,
    settings.instruments,
  );
  const row: Omit<NewTrade, 'userId' | 'accountId'> = {
    instrument: normalizeSymbol(input.instrument),
    direction: input.direction,
    sizeLots: input.sizeLots,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    targetPrice: input.targetPrice,
    openedAt: new Date(input.openedAt),
    closedAt: input.closedAt ? new Date(input.closedAt) : null,
    exitPrice: input.exitPrice,
    pnl: input.closedAt ? math.pnl : null,
    riskAmount: math.riskAmount,
    rMultiple: input.closedAt ? math.rMultiple : null,
    exitType: input.closedAt ? input.exitType : 'open',
    setupTag: input.setupTag || null,
    preNote: input.preNote || null,
    overrideFlag: input.overrideFlag,
    overrideKind: input.overrideFlag ? input.overrideKind : null,
    overrideNote: input.overrideFlag ? input.overrideNote || null : null,
    source,
  };
  return { row, warnings: math.warnings, formula: math.formula };
}

export interface TradeDto {
  id: string;
  accountId: string;
  instrument: string;
  direction: 'long' | 'short';
  sizeLots: number;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  pnl: number | null;
  riskAmount: number | null;
  rMultiple: number | null;
  exitType: Trade['exitType'];
  setupTag: string | null;
  preNote: string | null;
  overrideFlag: boolean;
  overrideKind: Trade['overrideKind'];
  overrideNote: string | null;
  source: Trade['source'];
  noteLabels: unknown;
  labelsVersion: string | null;
  labelsStatus: Trade['labelsStatus'];
}

export const tradeDto = (t: Trade): TradeDto => ({
  id: t.id,
  accountId: t.accountId,
  instrument: t.instrument,
  direction: t.direction,
  sizeLots: t.sizeLots,
  entryPrice: t.entryPrice,
  stopPrice: t.stopPrice,
  targetPrice: t.targetPrice,
  openedAt: t.openedAt.toISOString(),
  closedAt: t.closedAt?.toISOString() ?? null,
  exitPrice: t.exitPrice,
  pnl: t.pnl,
  riskAmount: t.riskAmount,
  rMultiple: t.rMultiple,
  exitType: t.exitType,
  setupTag: t.setupTag,
  preNote: t.preNote,
  overrideFlag: t.overrideFlag,
  overrideKind: t.overrideKind,
  overrideNote: t.overrideNote,
  source: t.source,
  noteLabels: t.noteLabels,
  labelsVersion: t.labelsVersion,
  labelsStatus: t.labelsStatus,
});
