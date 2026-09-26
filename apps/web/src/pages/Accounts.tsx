import { Link } from 'react-router';
import { Plus, Wallet } from 'lucide-react';
import { useAccounts } from '../components/AccountSwitcher';
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { useActiveAccountId } from '../lib/hooks';

export function AccountsPage() {
  const q = useAccounts();
  const [activeId, setActive] = useActiveAccountId();
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Each evaluation or funded account has its own rules."
        actions={
          <Link to="/accounts/new">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Add account
            </Button>
          </Link>
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && (
        <EmptyState icon={<Wallet className="size-5" />} title="No accounts yet">
          Add the evaluation you’re working on.
        </EmptyState>
      )}
      {q.data && q.data.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Starting balance</th>
                <th className="px-4 py-2.5 font-medium">Rules</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((a) => (
                <tr key={a.id} className="bg-bg hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.label}</div>
                    <div className="text-xs text-fg-subtle">{a.rules.dayResetTimezone}</div>
                  </td>
                  <td className="num px-4 py-3">{fmtMoney(a.startingBalance, a.currency, 0)}</td>
                  <td className="num px-4 py-3 text-fg-muted">
                    +{a.rules.profitTargetPct}% · −{a.rules.maxDailyLossPct}%/day · −{a.rules.maxLossPct}%{' '}
                    {a.rules.maxLossType === 'static' ? 'static' : 'trailing'}
                  </td>
                  <td className="px-4 py-3">
                    {a.status === 'active' ? <Badge tone="go">Active</Badge> : <Badge>Archived</Badge>}{' '}
                    {a.id === activeId && <Badge tone="accent">Selected</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.id !== activeId && a.status === 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => setActive(a.id)}>
                        Select
                      </Button>
                    )}
                    <Link to={`/accounts/${a.id}`}>
                      <Button size="sm">Edit</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
