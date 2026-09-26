import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronRight, Lightbulb, Loader2 } from 'lucide-react';
import {
  BEHAVIOUR_DIMENSIONS,
  DIM_TEXT,
  LOSS_BUCKETS,
  MIN_N,
  PNL_BANDS,
  type BehaviourDim,
  type BehaviourProfile,
  type GroupStat,
} from '@cooldown/core';
import { api } from '../lib/api';
import { useActiveAccount } from '../components/AccountSwitcher';
import {
  Badge,
  Button,
  Card,
  Disclaimer,
  EmptyState,
  ErrorBox,
  Gated,
  PageHeader,
  Segmented,
  Spinner,
  Stat,
} from '../components/ui';
import { RDistributionChart, SignedBars, type GroupDatum } from '../components/charts';
import { EvidenceDrawer } from '../components/Evidence';
import { fmtMoney, fmtPct, fmtR } from '../lib/format';
import { cn } from '../lib/cn';

const SESSION_LABEL: Record<string, string> = {
  asia: 'Asia',
  london: 'London',
  ny: 'New York',
  off: 'Off-hours',
};
const DRIVER_LABEL: Record<string, string> = {
  plan: 'Plan',
  fomo: 'FOMO',
  revenge: 'Revenge',
  fear: 'Fear',
  greed: 'Greed',
  boredom: 'Boredom',
  unclear: 'Unclear',
};
const BAND_LABEL: Record<string, string> = {
  up: 'Day up',
  flat: 'Day flat',
  down_lt50: 'Down < ½ limit',
  down_ge50: 'Down ≥ ½ limit',
};

const toDatum = (g: GroupStat, label = g.key): GroupDatum => ({
  key: g.key,
  label,
  value: g.avgR,
  n: g.n,
  enough: g.nR >= MIN_N,
});

export function InsightsPage() {
  const { account } = useActiveAccount();
  const [evidence, setEvidence] = useState<{ title: string; ids: string[] } | null>(null);
  const [breakdown, setBreakdown] = useState<'setup' | 'session' | 'weekday'>('setup');
  const [dim, setDim] = useState<BehaviourDim>('sizeUp');
  const q = useQuery({
    queryKey: ['profile', account?.id],
    queryFn: () =>
      api.get<{ profile: BehaviourProfile; labelsPending: number }>(`/api/profile?accountId=${account!.id}`),
    enabled: !!account,
    refetchInterval: (query) => (query.state.data?.labelsPending ? 3000 : false),
  });
  if (!account) return <Spinner />;
  if (q.isLoading) return <Spinner label="Building your profile…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const p = q.data!.profile;
  const m = p.metrics;
  const cur = account.currency;
  const show = (title: string, ids: string[]) => setEvidence({ title, ids });

  if (p.tradeCount === 0)
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="Your profile builds from closed trades"
          action={
            <div className="flex gap-2">
              <Link to="/trades/new">
                <Button variant="primary">Log a trade</Button>
              </Link>
              <Link to="/import">
                <Button>Import history</Button>
              </Link>
            </div>
          }
        >
          Once you have about 10 closed trades, patterns start to show — what you do after losses, which
          setups and sessions work for you.
        </EmptyState>
      </>
    );

  const breakdownData =
    breakdown === 'setup'
      ? m.bySetup.map((g) => toDatum(g))
      : breakdown === 'session'
        ? m.bySession.map((g) => toDatum(g, SESSION_LABEL[g.key] ?? g.key))
        : m.byWeekday.map((g) => toDatum(g));
  const breakdownGroups =
    breakdown === 'setup' ? m.bySetup : breakdown === 'session' ? m.bySession : m.byWeekday;

  return (
    <>
      <PageHeader
        title="Insights"
        description={`What your own ${p.tradeCount} closed trades in ${account.label} say about how you trade.`}
        actions={
          q.data!.labelsPending > 0 && (
            <Badge tone="info">
              <Loader2 className="size-3 animate-spin" /> classifying {q.data!.labelsPending} notes
            </Badge>
          )
        }
      />
      <Disclaimer className="mb-5" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Closed trades" value={p.tradeCount} sub={`${m.tradesPerDay.days} trading days`} />
        <Stat
          label="Win rate"
          value={<Gated n={m.overall.n}>{fmtPct(m.overall.winRate)}</Gated>}
          sub={`n=${m.overall.n}`}
        />
        <Stat
          label="Expectancy (avg R)"
          value={<Gated n={m.overall.nR}>{fmtR(m.overall.avgR)}</Gated>}
          sub={`n=${m.overall.nR} trades with a stop`}
          title="Average R-multiple per trade = sum of R / number of trades with a defined risk"
        />
        <Stat
          label="Net P&L"
          value={fmtMoney(m.overall.netPnl, cur, 0)}
          sub={`${fmtMoney(m.overall.expectancyMoney, cur)} per trade`}
        />
      </div>

      {p.insights.length > 0 && (
        <Card
          className="mt-5"
          title="What stands out"
          subtitle="Only patterns with at least 10 trades behind them"
        >
          <ul className="divide-y divide-line">
            {p.insights.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg',
                    i.tone === 'caution'
                      ? 'bg-caution-soft text-caution'
                      : i.tone === 'positive'
                        ? 'bg-go-soft text-go'
                        : 'bg-surface-3 text-fg-muted',
                  )}
                >
                  <Lightbulb className="size-4" />
                </span>
                <p className="flex-1 text-sm">{i.text}</p>
                <Button size="sm" variant="ghost" onClick={() => show(i.text, i.tradeIds)}>
                  Evidence <ChevronRight className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="R-multiple distribution" subtitle={`n=${m.overall.nR} trades with a defined stop`}>
          <Gated n={m.overall.nR}>
            <RDistributionChart data={m.rDistribution} />
          </Gated>
        </Card>
        <Card
          title="Average R by group"
          subtitle="Click a row to see the trades"
          actions={
            <Segmented
              size="sm"
              value={breakdown}
              onChange={setBreakdown}
              options={[
                { value: 'setup', label: 'Setup' },
                { value: 'session', label: 'Session' },
                { value: 'weekday', label: 'Weekday' },
              ]}
            />
          }
        >
          <SignedBars
            data={breakdownData}
            onSelect={(k) => {
              const g = breakdownGroups.find((x) => x.key === k);
              if (g) show(`${breakdown === 'session' ? (SESSION_LABEL[k] ?? k) : k} trades`, g.tradeIds);
            }}
          />
          {breakdown === 'session' && (
            <p className="mt-3 text-[11px] text-fg-subtle">
              Sessions by UTC hour: Asia 00–07, London 07–12, New York 12–21.
            </p>
          )}
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold">After a loss</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <CompareTile
          label={`Size after a loss vs usual`}
          value={<Gated n={m.sizing.afterLoss.n}>{m.sizing.afterLoss.ratio?.toFixed(2)}×</Gated>}
          sub={`after a win: ${m.sizing.afterWin.ratio?.toFixed(2) ?? '—'}× · n=${m.sizing.afterLoss.n}`}
          title={`Average ${m.sizing.basis === 'risk' ? 'risk amount' : 'lot size'} of the next trade after a loss, divided by your median`}
          warn={(m.sizing.afterLoss.ratio ?? 0) >= 1.15 && m.sizing.afterLoss.n >= MIN_N}
          onClick={() => show('Trades taken right after a loss', m.sizing.afterLoss.tradeIds)}
        />
        <CompareTile
          label="Minutes to next trade after a loss"
          value={
            <Gated n={m.reentry.nAfterLoss}>{Math.round(m.reentry.medianMinutesAfterLoss ?? 0)} min</Gated>
          }
          sub={`after a win: ${m.reentry.medianMinutesAfterWin != null ? Math.round(m.reentry.medianMinutesAfterWin) + ' min' : '—'} · median, n=${m.reentry.nAfterLoss}`}
        />
        <CompareTile
          label={`Trades within ${m.soonAfterLoss.minutes} min of a loss`}
          value={<Gated n={m.soonAfterLoss.within.nR}>{fmtR(m.soonAfterLoss.within.avgR)}</Gated>}
          sub={`avg R vs ${fmtR(m.soonAfterLoss.others.avgR)} otherwise · n=${m.soonAfterLoss.within.n}`}
          warn={
            m.soonAfterLoss.within.nR >= MIN_N &&
            (m.soonAfterLoss.within.avgR ?? 0) < (m.soonAfterLoss.others.avgR ?? 0)
          }
          onClick={() =>
            show(`Trades within ${m.soonAfterLoss.minutes} min of a loss`, m.soonAfterLoss.within.tradeIds)
          }
        />
        <CompareTile
          label={
            m.stopAfterLosses.rule
              ? `Stop after ${m.stopAfterLosses.rule} losses — kept`
              : 'Stop-after-losses rule'
          }
          value={
            m.stopAfterLosses.rule ? (
              m.stopAfterLosses.daysReached ? (
                `${fmtPct(m.stopAfterLosses.compliance)}`
              ) : (
                <span className="text-sm font-normal text-fg-subtle">never reached</span>
              )
            ) : (
              <span className="text-sm font-normal text-fg-subtle">no rule set</span>
            )
          }
          sub={`reached on ${m.stopAfterLosses.daysReached} days · later trades ${fmtR(m.stopAfterLosses.tradesAfterRule.netR)} net`}
          warn={(m.stopAfterLosses.compliance ?? 1) < 0.8}
          onClick={
            m.stopAfterLosses.tradesAfterRule.n
              ? () =>
                  show(
                    'Trades taken after hitting your stop rule',
                    m.stopAfterLosses.tradesAfterRule.tradeIds,
                  )
              : undefined
          }
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card
          title="Changing the plan mid-trade"
          subtitle={`${m.overrides.n} of ${p.tradeCount} trades (${fmtPct(m.overrides.rate)})`}
        >
          <div className="mb-4 grid grid-cols-2 gap-3">
            <MiniStat
              label="Plan changed"
              g={m.overrides.overridden}
              onClick={() => show('Trades where you changed the plan', m.overrides.overridden.tradeIds)}
            />
            <MiniStat label="Left alone" g={m.overrides.notOverridden} />
          </div>
          {m.overrides.byKind.length > 0 ? (
            <SignedBars
              data={m.overrides.byKind.map((g) => toDatum(g, g.key.replace('_', ' ')))}
              onSelect={(k) => {
                const g = m.overrides.byKind.find((x) => x.key === k);
                if (g) show(`Overrides: ${k.replace('_', ' ')}`, g.tradeIds);
              }}
            />
          ) : (
            <p className="text-sm text-fg-muted">No overrides flagged yet.</p>
          )}
        </Card>
        <Card
          title="What your notes say"
          subtitle={`${m.labels.labelled} labelled · ${m.labels.uncertain} uncertain (excluded) · plan adherence ${m.labels.planAdherence.n >= MIN_N ? fmtPct(m.labels.planAdherence.rate) : `n=${m.labels.planAdherence.n}`}`}
        >
          {m.labels.byDriver.length ? (
            <SignedBars
              unit="R"
              data={m.labels.byDriver.map((g) => ({
                key: g.key,
                label: DRIVER_LABEL[g.key] ?? g.key,
                value: g.netR,
                n: g.n,
                enough: g.n >= MIN_N,
              }))}
              onSelect={(k) => {
                const g = m.labels.byDriver.find((x) => x.key === k);
                if (g) show(`Trades where your note read as ${DRIVER_LABEL[k] ?? k}`, g.tradeIds);
              }}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              No labelled notes yet. Notes are classified in the background after you log or import trades.
            </p>
          )}
          <p className="mt-3 text-[11px] text-fg-subtle">
            Net R per note category. Labels come from your own one-line notes; uncertain labels are counted
            separately.
          </p>
        </Card>
      </div>

      <Card
        className="mt-5"
        title="How often behaviour shows up, by situation"
        subtitle={`Share of trades showing each behaviour, by losses in a row × today’s P&L. Feeds the simulator. ${p.conditionalProbs.classification.jev} trades classified from notes, ${p.conditionalProbs.classification.heuristic} by simple rules.`}
        actions={
          <select
            value={dim}
            onChange={(e) => setDim(e.target.value as BehaviourDim)}
            className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs"
            aria-label="Behaviour"
          >
            {BEHAVIOUR_DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {DIM_TEXT[d].short}
              </option>
            ))}
          </select>
        }
      >
        <Heatmap profile={p} dim={dim} />
      </Card>

      <EvidenceDrawer
        title={evidence?.title ?? ''}
        ids={evidence?.ids ?? null}
        currency={cur}
        onClose={() => setEvidence(null)}
      />
    </>
  );
}

function CompareTile({
  label,
  value,
  sub,
  warn,
  title,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  warn?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      title={title}
      className="rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors enabled:hover:border-line-strong enabled:hover:bg-surface-2/60"
    >
      <div className="text-[12px] font-medium text-fg-muted">{label}</div>
      <div className={cn('num mt-1 text-[22px] leading-tight font-semibold', warn && 'text-caution')}>
        {value}
      </div>
      <div className="mt-1 text-xs text-fg-subtle">{sub}</div>
    </button>
  );
}

function MiniStat({ label, g, onClick }: { label: string; g: GroupStat; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="rounded-lg bg-surface-2 px-3 py-2.5 text-left enabled:hover:bg-surface-3"
    >
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold">
        <Gated n={g.nR}>{fmtR(g.avgR)}</Gated>
      </div>
      <div className="text-[11px] text-fg-subtle">avg R · n={g.n}</div>
    </button>
  );
}

function Heatmap({ profile, dim }: { profile: BehaviourProfile; dim: BehaviourDim }) {
  const cells = profile.conditionalProbs.buckets;
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate border-spacing-1 text-center text-xs">
        <thead>
          <tr>
            <th className="w-32 text-left font-medium text-fg-subtle">Losses in a row</th>
            {PNL_BANDS.map((b) => (
              <th key={b} className="font-medium text-fg-subtle">
                {BAND_LABEL[b]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LOSS_BUCKETS.map((l) => (
            <tr key={l}>
              <td className="text-left font-medium text-fg-muted">{l}</td>
              {PNL_BANDS.map((b) => {
                const c = cells.find((x) => x.losses === l && x.band === b)!;
                const v = c.smoothed[dim];
                const opp = c.opportunities[dim];
                return (
                  <td
                    key={b}
                    title={`${l} losses, ${BAND_LABEL[b]}: ${Math.round(v * 100)}% (${c.counts[dim]} of ${opp})${c.lowData ? ' — low data, blended with neighbouring situations' : ''}`}
                    className={cn('h-14 rounded-md', c.lowData && 'border border-dashed border-fg-subtle/50')}
                    style={{ background: `rgba(57,135,229,${0.06 + v * 0.8})` }}
                  >
                    <div className={cn('num text-[13px] font-semibold', v > 0.45 ? 'text-white' : 'text-fg')}>
                      {Math.round(v * 100)}%
                    </div>
                    <div className={cn('num text-[10px]', v > 0.45 ? 'text-white/80' : 'text-fg-subtle')}>
                      n={opp}
                      {c.lowData ? ' · low' : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-fg-subtle">
        Dashed cells have fewer than 8 observations and are blended with neighbouring situations.
      </p>
    </div>
  );
}
