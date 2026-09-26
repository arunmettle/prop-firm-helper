import type { AccountEvaluation, Rules, TraderRules } from '@cooldown/core';

export interface AccountDto {
  id: string;
  label: string;
  firmPreset: string | null;
  startingBalance: number;
  currency: string;
  rules: Rules;
  traderRules: TraderRules;
  startDate: string | null;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface AccountStatusDto {
  evaluation: AccountEvaluation;
  closedTrades: number;
  openTrades: number;
  tradesToday: number;
  lossesInARowToday: number;
}
