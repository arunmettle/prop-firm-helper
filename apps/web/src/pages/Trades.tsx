import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ListOrdered, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useActiveAccount } from '../components/AccountSwitcher';
import { TradeTable } from '../components/TradeTable';
import { Button, Card, EmptyState, ErrorBox, Input, Kbd, PageHeader, Select, Spinner } from '../components/ui';
import type { TradeDto } from '../lib/types';

export function TradesPage() {
  const { account } = useActiveAccount();
  const [outcome, setOutcome] = useState('all');
  const [setup, setSetup] = useState('');
  const [override, setOverride] = useState('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams({ accountId: account?.id ?? '', outcome, override });
  if (setup) params.set('setup', setup);
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
  const q = useQuery({
    queryKey: ['trades', params.toString()],
    queryFn: () => api.get<{ trades: TradeDto[]; total: number }>(`/api/trades?${params}`),
    enabled: !!account,
    refetchInterval: (query) => (query.state.data?.trades.some((t) => t.labelsStatus === 'pending') ? 2000 : false),
  });
  const tags = useQuery({
    queryKey: ['setup-tags', account?.id],
    queryFn: () => api.get<string[]>(`/api/trades/setup-tags?accountId=${account!.id}`),
    enabled: !!account,
  });
  if (!account) return <Spinner />;
  const filtered = outcome !== 'all' || setup || override !== 'any' || from || to;

  return (
    <>
      <PageHeader
        title="Trades"
        description={q.data ? `${q.data.total} trade${q.data.total === 1 ? '' : 's'} in ${account.label}` : undefined}
        actions={
          <Link to="/trades/new">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Log trade <Kbd>N</Kbd>
            </Button>
          </Link>
        }
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-32" aria-label="Outcome">
            <option value="all">All outcomes</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="open">Open</option>
          </Select>
          <Select value={setup} onChange={(e) => setSetup(e.target.value)} className="w-44" aria-label="Setup">
            <option value="">All setups</option>
            {tags.data?.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
          <Select value={override} onChange={(e) => setOverride(e.target.value)} className="w-40" aria-label="Override">
            <option value="any">Any plan changes</option>
            <option value="yes">Plan changed</option>
            <option value="no">No plan change</option>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" />
          <span className="text-xs text-fg-subtle">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" />
          {filtered && (
            <Button size="sm" variant="ghost" onClick={() => { setOutcome('all'); setSetup(''); setOverride('any'); setFrom(''); setTo(''); }}>
              Clear
            </Button>
          )}
        </div>
        {q.isLoading && <Spinner />}
        {q.error && <div className="p-4"><ErrorBox error={q.error} /></div>}
        {q.data && q.data.trades.length === 0 && (
          <div className="p-5">
            <EmptyState
              icon={<ListOrdered className="size-5" />}
              title={filtered ? 'No trades match these filters' : 'No trades yet'}
              action={
                !filtered && (
                  <div className="flex gap-2">
                    <Link to="/trades/new"><Button variant="primary">Log your first trade</Button></Link>
                    <Link to="/import"><Button>Import a CSV</Button></Link>
                  </div>
                )
              }
            >
              {!filtered && 'Log trades as you take them, or import your history from a CSV export.'}
            </EmptyState>
          </div>
        )}
        {q.data && q.data.trades.length > 0 && <TradeTable trades={q.data.trades} currency={account.currency} />}
      </Card>
    </>
  );
}
