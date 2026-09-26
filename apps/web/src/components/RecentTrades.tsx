import { Link } from 'react-router';
import { Card } from './ui';
import type { AccountDto } from '../lib/types';

/** Replaced in phase 3 with the real list. */
export function RecentTrades({ account }: { account: AccountDto }) {
  return (
    <Card title="Recent trades" actions={<Link className="text-xs text-accent" to="/trades">View all</Link>}>
      <p className="text-sm text-fg-muted">No trades logged for {account.label} yet.</p>
    </Card>
  );
}
