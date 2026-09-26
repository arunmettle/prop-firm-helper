import type { AccountEvaluation, Rules, TodayStats, TraderRules } from '@cooldown/core';

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
  today: TodayStats;
  closedTrades: number;
  openTrades: number;
}

export interface NoteLabelsDto {
  version: string;
  primary_driver?: { value: string; confidence: number; uncertain: boolean };
  followed_own_plan?: { p: number; uncertain: boolean };
  impulsiveness?: { value: string; score: number; confidence: number; uncertain: boolean };
  override_justified?: { p: number; uncertain: boolean };
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
  exitType: 'target' | 'stop' | 'manual_close' | 'breakeven' | 'open';
  setupTag: string | null;
  preNote: string | null;
  overrideFlag: boolean;
  overrideKind: 'moved_stop' | 'moved_target' | 'closed_early' | 'added_size' | 'removed_stop' | null;
  overrideNote: string | null;
  source: 'manual' | 'csv';
  noteLabels: NoteLabelsDto | null;
  labelsVersion: string | null;
  labelsStatus: 'pending' | 'done' | 'failed' | 'none';
}
