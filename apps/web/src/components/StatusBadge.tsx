import type { AccountEvaluation } from '@cooldown/core';
import { Badge } from './ui';

export function StatusBadge({ status }: { status: AccountEvaluation['status'] }) {
  if (status === 'passed') return <Badge tone="go">Target reached</Badge>;
  if (status === 'breached') return <Badge tone="stop">Rule breached</Badge>;
  if (status === 'timed_out') return <Badge tone="caution">Time limit reached</Badge>;
  return <Badge tone="accent">In progress</Badge>;
}

export const RULE_TEXT: Record<string, string> = {
  max_daily_loss: 'Max daily loss',
  max_loss: 'Max loss',
  max_calendar_days: 'Calendar-day limit',
};
