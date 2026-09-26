import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';

interface Usage {
  provider: string;
  users: {
    email: string;
    calls: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  jobs: { queued: number; running: number; failed: number };
  simulations: number;
  creditsSold: number;
}

export function AdminPage() {
  const q = useQuery({ queryKey: ['admin-usage'], queryFn: () => api.get<Usage>('/api/admin/usage') });
  return (
    <>
      <PageHeader
        title="Admin"
        description="Model usage and queue health. Counters only — no trade content is visible here."
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Jev provider" value={q.data.provider} />
            <Stat label="Jobs queued" value={q.data.jobs.queued} />
            <Stat
              label="Jobs failed"
              value={q.data.jobs.failed}
              tone={q.data.jobs.failed ? 'caution' : undefined}
            />
            <Stat label="Simulations" value={q.data.simulations} />
            <Stat label="Credits sold" value={q.data.creditsSold} />
          </div>
          <Card title="Jev usage by user" subtitle="Last 30 days" bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                  <th className="px-4 py-2.5 text-right font-medium">Failures</th>
                  <th className="px-4 py-2.5 text-right font-medium">Input tokens</th>
                  <th className="px-4 py-2.5 text-right font-medium">Output tokens</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.users.map((u) => (
                  <tr key={u.email}>
                    <td className="px-4 py-2.5">{u.email}</td>
                    <td className="num px-4 py-2.5 text-right">{u.calls.toLocaleString()}</td>
                    <td className="num px-4 py-2.5 text-right">{u.failures.toLocaleString()}</td>
                    <td className="num px-4 py-2.5 text-right">{u.inputTokens.toLocaleString()}</td>
                    <td className="num px-4 py-2.5 text-right">{u.outputTokens.toLocaleString()}</td>
                    <td className="num px-4 py-2.5 text-right">${(u.costUsd ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
                {!q.data.users.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-fg-muted">
                      No usage yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
