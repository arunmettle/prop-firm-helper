import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AccountDto, TradeDto } from '../lib/types';
import { Card, Spinner } from './ui';
import { TradeTable } from './TradeTable';

export function RecentTrades({ account }: { account: AccountDto }) {
  const q = useQuery({
    queryKey: ['trades', 'recent', account.id],
    queryFn: () => api.get<{ trades: TradeDto[]; total: number }>(`/api/trades?accountId=${account.id}&limit=6`),
  });
  return (
    <Card
      title="Recent trades"
      actions={
        <Link className="text-xs text-accent hover:underline" to="/trades">
          View all
        </Link>
      }
      bodyClassName="p-0"
    >
      {q.isLoading && <Spinner />}
      {q.data && q.data.trades.length === 0 && (
        <p className="px-5 py-6 text-sm text-fg-muted">
          No trades logged yet.{' '}
          <Link to="/trades/new" className="text-accent hover:underline">
            Log one
          </Link>{' '}
          or{' '}
          <Link to="/import" className="text-accent hover:underline">
            import a CSV
          </Link>
          .
        </p>
      )}
      {q.data && q.data.trades.length > 0 && <TradeTable trades={q.data.trades} currency={account.currency} compact />}
    </Card>
  );
}
