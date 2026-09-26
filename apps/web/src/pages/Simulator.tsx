import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Coins,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import type { Finding, ScenarioResult, SimResult } from '@cooldown/core/sim';
import { api, errorText } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useActiveAccount } from '../components/AccountSwitcher';
import { Badge, Button, Card, Disclaimer, EmptyState, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { EvidenceDrawer } from '../components/Evidence';
import { fmtDateTime } from '../lib/format';
import { cn } from '../lib/cn';
import { DIM_TEXT } from '@cooldown/core';

interface SimDto {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: string;
  error: string | null;
  runs: number | null;
  seed: number | null;
  historyTrades: number | null;
  trader: { riskPct: number; stopAfterLosses: number | null; maxTradesPerDay: number | null } | null;
  result?: SimResult | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function SimulatorPage() {
  const { account } = useActiveAccount();
  const me = useMe();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['sims', account?.id],
    queryFn: () => api.get<SimDto[]>(`/api/simulations?accountId=${account!.id}`),
    enabled: !!account,
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === 'queued' || s.status === 'running') ? 1500 : false,
  });
  const current = selected ?? list.data?.[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ['sim', current],
    queryFn: () => api.get<SimDto>(`/api/simulations/${current}`),
    enabled: !!current,
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === 'queued' || q.state.data.status === 'running') ? 1500 : false,
  });
  const profile = useQuery({
    queryKey: ['profile', account?.id],
    queryFn: () => api.get<{ profile: { tradeCount: number } }>(`/api/profile?accountId=${account!.id}`),
    enabled: !!account,
  });
  const start = useMutation({
    mutationFn: () => api.post<SimDto>('/api/simulations', { accountId: account!.id }),
    onSuccess: (s) => {
      setSelected(s.id);
      qc.invalidateQueries({ queryKey: ['sims'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  useEffect(() => {
    if (detail.data?.status === 'done' || detail.data?.status === 'failed')
      qc.invalidateQueries({ queryKey: ['me'] });
  }, [detail.data?.status, qc]);

  if (!account) return <Spinner />;
  const credits = me.data?.credits ?? 0;
  const n = profile.data?.profile.tradeCount ?? 0;

  return (
    <>
      <PageHeader
        title="Challenge simulator"
        description="Replays your evaluation thousands of times from your own trade outcomes and measured habits — to show which behaviour decides the result. It is a comparison, not a forecast."
      />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <Coins className="size-4" /> Balance
              <span className="num ml-auto text-base font-semibold text-fg">
                {credits} credit{credits === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-3 text-sm text-fg-muted">
              10,000 simulated challenges per scenario from your {n} closed trade{n === 1 ? '' : 's'}.
              {n < 30 && ' With fewer than 30, results use example behaviour archetypes.'}
            </p>
            <Button
              className="mt-4 w-full"
              variant="primary"
              size="lg"
              icon={<FlaskConical className="size-4" />}
              disabled={credits < 1}
              loading={start.isPending}
              onClick={() => start.mutate()}
              data-testid="run-sim"
            >
              Run simulation · 1 credit
            </Button>
            {credits < 1 && (
              <p className="mt-2 text-xs text-fg-subtle">
                Out of credits.{' '}
                <Link to="/credits" className="text-accent hover:underline">
                  Get more
                </Link>
              </p>
            )}
            {start.error && <p className="mt-2 text-xs text-stop">{errorText(start.error)}</p>}
          </Card>
          {list.data && list.data.length > 0 && (
            <Card title="Past runs" bodyClassName="p-1.5">
              <ul>
                {list.data.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelected(s.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2',
                        s.id === current && 'bg-surface-3',
                      )}
                    >
                      <span className="num flex-1 text-fg-muted">{fmtDateTime(s.createdAt)}</span>
                      {s.status === 'done' ? (
                        <Badge tone="go">done</Badge>
                      ) : s.status === 'failed' ? (
                        <Badge tone="stop">failed</Badge>
                      ) : (
                        <Badge tone="info">
                          <Loader2 className="size-3 animate-spin" />
                          {s.status}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {!current && (
            <EmptyState icon={<Activity className="size-5" />} title="No simulations yet">
              Run one to see how your measured behaviour changes your simulated pass rate — and which single
              habit matters most.
            </EmptyState>
          )}
          {detail.error && <ErrorBox error={detail.error} />}
          {detail.data && (detail.data.status === 'queued' || detail.data.status === 'running') && (
            <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface py-20">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="mt-3 text-sm font-medium">Simulating 10,000 challenges per scenario…</p>
              <p className="mt-1 text-xs text-fg-subtle">Usually a few seconds.</p>
            </div>
          )}
          {detail.data?.status === 'failed' && (
            <ErrorBox title="Simulation failed" error={new Error(detail.data.error ?? 'Failed')} />
          )}
          {detail.data?.status === 'done' && detail.data.result && (
            <SimResultView sim={detail.data} r={detail.data.result} currency={account.currency} />
          )}
        </div>
      </div>
    </>
  );
}

function SimResultView({ sim, r, currency }: { sim: SimDto; r: SimResult; currency: string }) {
  const [evidence, setEvidence] = useState<string[] | null>(null);
  const main = r.scenarios.filter(
    (s) => s.kind === 'baseline' || s.kind === 'measured' || s.kind === 'archetype',
  );
  const reference =
    r.scenarios.find((s) => s.kind === 'measured') ?? r.scenarios.find((s) => s.id === 'archetype_typical')!;
  const byDay = reference.breachByDay
    .map((n, i) => ({ day: i + 1, n }))
    .slice(0, Math.max(10, reference.breachByDay.findLastIndex((n) => n > 0) + 2));
  const breaches = Object.values(reference.breachByRule).reduce((a, b) => a + b, 0);
  const top = r.ranking[0];

  return (
    <div className="space-y-5" data-testid="sim-result">
      {r.illustrative && (
        <div className="flex items-start gap-3 rounded-xl border border-caution/30 bg-caution-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" />
          <div>
            <div className="font-medium text-caution">Illustrative — not your profile yet</div>
            <div className="text-fg-muted">
              You have {r.historyTrades} closed trades; below 30 we use example behaviour archetypes
              (disciplined / typical / tilt-prone) with your account’s rules and your own risk settings.
            </div>
          </div>
        </div>
      )}
      <Disclaimer />

      <Card
        title="Simulated outcomes"
        subtitle={`${r.runs.toLocaleString()} runs per scenario · ${r.horizonIsRule ? `${r.horizonDays}-day limit` : `stops at day ${r.horizonDays} (no calendar limit)`} · 95% intervals`}
      >
        <div className="space-y-4">
          {main.map((s) => (
            <OutcomeBar key={s.id} s={s} emphasis={s.id === reference.id} />
          ))}
        </div>
        <Legend />
      </Card>

      <Card
        title="What moves your outcome most"
        subtitle={`Each line re-runs “${reference.label}” with one behaviour removed.`}
      >
        <ul className="space-y-1">
          {r.ranking.map((f, i) => (
            <FindingRow
              key={f.id}
              f={f}
              highlight={i === 0 && f.delta > 0.005}
              onEvidence={i === 0 && r.topEvidence ? () => setEvidence(r.topEvidence!.tradeIds) : undefined}
            />
          ))}
        </ul>
        {top && top.delta <= 0.005 && (
          <p className="mt-3 text-sm text-fg-muted">
            No single behaviour moves the simulated pass rate by more than half a point.
          </p>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Your own rules, varied" subtitle="Same behaviour, different personal rules">
          <ul className="space-y-1">
            {r.ruleSweeps.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        </Card>
        <Card
          title="When and how breaches happen"
          subtitle={`${reference.label} · ${pct(reference.breach.p)} of runs breached`}
        >
          <div className="mb-3 flex gap-4 text-sm">
            {Object.entries(reference.breachByRule).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="text-xs text-fg-muted">
                  {k === 'max_daily_loss' ? 'Daily loss limit' : 'Max loss limit'}
                </div>
                <div className="num text-base font-semibold">{breaches ? pct(v / breaches) : '—'}</div>
              </div>
            ))}
          </div>
          <div className="h-40" role="img" aria-label="Breaches by day">
            <ResponsiveContainer>
              <BarChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--color-viz-grid)" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-line-strong)' }}
                />
                <YAxis
                  tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs">
                        Day {payload[0].payload.day}:{' '}
                        <span className="num">{payload[0].payload.n.toLocaleString()}</span> breaches
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="n" fill="var(--color-viz-neg)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <p className="text-xs text-fg-subtle">
        Built from {r.historyTrades} of your closed trades ({r.poolSizes.plan} plan, {r.poolSizes.tilt} tilt
        outcomes) · seed {r.seed} · risk {sim.trader?.riskPct}% · computed in{' '}
        {(r.elapsedMs / 1000).toFixed(1)} s. Losing trades are assumed to touch their full stop before
        closing, so daily-loss checks aren’t optimistic.
      </p>
      <EvidenceDrawer
        title={top?.dim ? `Trades showing: ${DIM_TEXT[top.dim].short.toLowerCase()}` : 'Evidence'}
        ids={evidence}
        currency={currency}
        onClose={() => setEvidence(null)}
      />
    </div>
  );
}

function OutcomeBar({ s, emphasis }: { s: ScenarioResult; emphasis: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={cn('text-sm', emphasis ? 'font-semibold' : 'text-fg-muted')}>{s.label}</span>
        <span className="num text-sm">
          <span className="font-semibold">{pct(s.pass.p)}</span>
          <span className="text-fg-subtle">
            {' '}
            simulated pass rate ({pct(s.pass.lo)}–{pct(s.pass.hi)})
          </span>
        </span>
      </div>
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]"
        title={`Pass ${pct(s.pass.p)} · breach ${pct(s.breach.p)} · not finished ${pct(s.timeout.p)}`}
      >
        <div className="bg-[var(--color-viz-pos)]" style={{ width: `${s.pass.p * 100}%` }} />
        <div className="bg-[var(--color-viz-neg)]" style={{ width: `${s.breach.p * 100}%` }} />
        <div className="bg-[var(--color-viz-mid)]" style={{ width: `${s.timeout.p * 100}%` }} />
      </div>
      <div className="num mt-1 flex gap-4 text-[11px] text-fg-subtle">
        <span>breach {pct(s.breach.p)}</span>
        <span>not finished {pct(s.timeout.p)}</span>
        {s.medianPassDay && <span>median pass day {s.medianPassDay}</span>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex gap-4 border-t border-line pt-3 text-xs text-fg-muted">
      {[
        ['var(--color-viz-pos)', 'Passed'],
        ['var(--color-viz-neg)', 'Breached a rule'],
        ['var(--color-viz-mid)', 'Not finished in time'],
      ].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function FindingRow({
  f,
  highlight,
  onEvidence,
}: {
  f: Finding;
  highlight?: boolean;
  onEvidence?: () => void;
}) {
  const d = f.delta;
  return (
    <li className={cn('flex items-center gap-3 rounded-lg px-2 py-2', highlight && 'bg-accent-soft')}>
      <span className="flex-1 text-sm">{f.label}</span>
      <span className="num flex items-center gap-1.5 text-sm">
        <span className="text-fg-muted">{pct(f.from)}</span>
        <ArrowRight className="size-3.5 text-fg-subtle" />
        <span className="font-semibold">{pct(f.to)}</span>
      </span>
      <span
        className={cn(
          'num w-14 text-right text-xs',
          d > 0.005
            ? 'text-[var(--color-viz-pos)]'
            : d < -0.005
              ? 'text-[var(--color-viz-neg)]'
              : 'text-fg-subtle',
        )}
      >
        {Math.round(Math.abs(d * 100)) === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d * 100))}`}{' '}
        pts
      </span>
      {onEvidence ? (
        <Button size="sm" variant="ghost" onClick={onEvidence}>
          Show the evidence <ChevronRight className="size-3.5" />
        </Button>
      ) : (
        highlight !== undefined && <span className="w-[150px]" />
      )}
    </li>
  );
}
