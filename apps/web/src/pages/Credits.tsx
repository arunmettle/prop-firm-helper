import { useMutation, useQuery } from '@tanstack/react-query';
import { Coins, CreditCard, Terminal } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { fmtDateTime } from '../lib/format';

interface CreditsDto {
  balance: number;
  paymentsEnabled: boolean;
  packs: { id: string; credits: number; label: string }[];
  ledger: {
    id: string;
    delta: number;
    reason: 'purchase' | 'simulation' | 'admin_grant' | 'refund';
    createdAt: string;
  }[];
}

const REASON: Record<string, string> = {
  purchase: 'Purchase',
  simulation: 'Simulation',
  admin_grant: 'Granted',
  refund: 'Refund',
};

export function CreditsPage() {
  const q = useQuery({ queryKey: ['credits'], queryFn: () => api.get<CreditsDto>('/api/credits') });
  const status = new URLSearchParams(window.location.search).get('status');
  const checkout = useMutation({
    mutationFn: (packId: string) => api.post<{ url: string }>('/api/credits/checkout', { packId }),
    onSuccess: (r) => window.location.assign(r.url),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  return (
    <>
      <PageHeader
        title="Credits"
        description="One credit runs one simulation (10,000 runs per scenario). Failed simulations are refunded automatically."
      />
      {status === 'success' && (
        <p className="mb-4 rounded-lg border border-go/30 bg-go-soft px-3 py-2 text-sm text-go">
          Payment received — credits appear as soon as Stripe confirms it.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Stat
            label="Balance"
            value={<span data-testid="credits-page-balance">{d.balance}</span>}
            sub="Sum of your ledger — never a stored number"
          />
          {d.paymentsEnabled ? (
            <Card title="Buy credits" subtitle="Secure checkout by Stripe (test mode)">
              <div className="space-y-2">
                {d.packs.map((p) => (
                  <Button
                    key={p.id}
                    className="w-full justify-between"
                    icon={<CreditCard className="size-4" />}
                    loading={checkout.isPending && checkout.variables === p.id}
                    onClick={() => checkout.mutate(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              {checkout.error && <p className="mt-2 text-xs text-stop">{errorText(checkout.error)}</p>}
            </Card>
          ) : (
            <Card title="Payments are off">
              <p className="text-sm text-fg-muted">In this deployment an admin grants credits:</p>
              <code className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-fg-muted">
                <Terminal className="size-3.5" /> pnpm admin:grant you@example.com 5
              </code>
            </Card>
          )}
        </div>
        <Card title="History" bodyClassName="p-0">
          {d.ledger.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">No credit activity yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-muted">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-5 py-2.5 font-medium">What</th>
                  <th className="px-5 py-2.5 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="num px-5 py-2.5 text-fg-muted">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-5 py-2.5">
                      <Badge
                        tone={
                          l.reason === 'simulation' ? 'neutral' : l.reason === 'refund' ? 'info' : 'accent'
                        }
                      >
                        {l.reason === 'simulation' ? <Coins className="size-3" /> : null}
                        {REASON[l.reason]}
                      </Badge>
                    </td>
                    <td
                      className={`num px-5 py-2.5 text-right font-medium ${l.delta > 0 ? 'text-go' : 'text-fg-muted'}`}
                    >
                      {l.delta > 0 ? '+' : '−'}
                      {Math.abs(l.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
