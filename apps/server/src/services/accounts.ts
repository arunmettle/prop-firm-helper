import { and, asc, eq } from 'drizzle-orm';
import {
  evaluateAccount,
  parseTraderRules,
  ruleSchema,
  todayStats,
  type AccountEvaluation,
  type Rules,
  type TodayStats,
  type TraderRules,
} from '@cooldown/core';
import type { Tx } from '../db/client.js';
import { trades, type Account } from '../db/schema.js';

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

export function accountDto(a: Account): AccountDto {
  return {
    id: a.id,
    label: a.label,
    firmPreset: a.firmPreset,
    startingBalance: a.startingBalance,
    currency: a.currency,
    rules: ruleSchema.parse(a.rules),
    traderRules: parseTraderRules(a.traderRules),
    startDate: a.startDate?.toISOString() ?? null,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}

export interface AccountStatus {
  evaluation: AccountEvaluation;
  today: TodayStats;
  closedTrades: number;
  openTrades: number;
}

/** Live account status: rule engine over closed trades, "now" = asOf. */
export async function accountStatus(db: Tx, account: Account, asOf = new Date(), openTradeRisk?: number | null): Promise<AccountStatus> {
  const rules = ruleSchema.parse(account.rules);
  const rows = await db
    .select({ openedAt: trades.openedAt, closedAt: trades.closedAt, pnl: trades.pnl })
    .from(trades)
    .where(and(eq(trades.accountId, account.id), eq(trades.userId, account.userId)))
    .orderBy(asc(trades.openedAt));
  const closed = rows.filter((r) => r.closedAt && r.pnl !== null && r.closedAt <= asOf);
  const evaluation = evaluateAccount(
    rules,
    account.startingBalance,
    closed.map((r) => ({ openedAt: r.openedAt, closedAt: r.closedAt!, pnl: r.pnl! })),
    openTradeRisk ?? null,
    { asOf, startDate: account.startDate ?? undefined },
  );
  return {
    evaluation,
    today: todayStats(rows, rules.dayResetTimezone, asOf),
    closedTrades: closed.length,
    openTrades: rows.filter((r) => !r.closedAt).length,
  };
}

