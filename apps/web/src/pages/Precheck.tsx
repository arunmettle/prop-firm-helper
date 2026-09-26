import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  CircleAlert,
  OctagonX,
  Info,
  ListPlus,
  Sigma,
} from 'lucide-react';
import type { PrecheckComputed, PrecheckJevView, Reason } from '@cooldown/core';
import { api, ApiError, errorText } from '../lib/api';
import { useActiveAccount } from '../components/AccountSwitcher';
import { useMe } from '../lib/hooks';
import { Badge, Button, Card, Disclaimer, Field, Input, Kbd, PageHeader, Spinner } from '../components/ui';
import { fmtDateTime, fmtMinutes, fmtMoney, fmtNum, fmtPct, fmtR } from '../lib/format';
import { cn } from '../lib/cn';

interface PrecheckDto {
  id: string;
  createdAt: string;
  input: {
    instrument: string;
    direction: 'long' | 'short';
    entry: number;
    stop: number;
    target: number | null;
    setupTag: string | null;
    riskPct: number;
    preNote: string;
  };
  computed: PrecheckComputed;
  reasons: Reason[];
  jev: PrecheckJevView;
  verdict: 'go' | 'caution' | 'stop';
  linkedTradeId: string | null;
}

const VERDICT = {
  go: {
    label: 'Clear by your rules',
    sub: 'Nothing in your rules or recent state flags this.',
    icon: CircleCheck,
    cls: 'border-go/30 bg-go-soft text-go',
  },
  caution: {
    label: 'Proceed with care',
    sub: 'Something in your recent state is worth a second look.',
    icon: CircleAlert,
    cls: 'border-caution/30 bg-caution-soft text-caution',
  },
  stop: {
    label: 'Your rules say stop',
    sub: 'At least one of your own hard rules is hit.',
    icon: OctagonX,
    cls: 'border-stop/30 bg-stop-soft text-stop',
  },
} as const;

export function PrecheckPage() {
  const { account } = useActiveAccount();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const entryRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    instrument: 'XAUUSD',
    direction: 'long' as 'long' | 'short',
    entry: '',
    stop: '',
    target: '',
    setupTag: '',
    riskPct: '',
    preNote: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tags = useQuery({
    queryKey: ['setup-tags', account?.id],
    queryFn: () => api.get<string[]>(`/api/trades/setup-tags?accountId=${account!.id}`),
    enabled: !!account,
  });
  const recent = useQuery({
    queryKey: ['prechecks', account?.id],
    queryFn: () => api.get<PrecheckDto[]>(`/api/prechecks?accountId=${account!.id}`),
    enabled: !!account,
  });
  useEffect(() => entryRef.current?.focus(), []);
  const defaultRisk = account?.traderRules.riskPct ?? me.data?.settings.defaultRiskPct ?? 1;

  const run = useMutation({
    mutationFn: () =>
      api.post<PrecheckDto>('/api/prechecks', {
        accountId: account!.id,
        instrument: f.instrument,
        direction: f.direction,
        entry: Number(f.entry),
        stop: Number(f.stop),
        target: f.target ? Number(f.target) : null,
        setupTag: f.setupTag.trim() || null,
        riskPct: f.riskPct ? Number(f.riskPct) : defaultRisk,
        preNote: f.preNote,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prechecks'] }),
    onError: (e) => {
      if (e instanceof ApiError && e.details)
        setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.entry) errs.entry = 'Required';
    if (!f.stop) errs.stop = 'Required';
    if (f.preNote.trim().length < 3) errs.preNote = 'One line on why — before you enter';
    setErrors(errs);
    if (!Object.keys(errs).length) run.mutate();
  };

  if (!account) return <Spinner />;
  const r = run.data;
  const cur = account.currency;

  return (
    <>
      <PageHeader
        title="Pre-trade check"
        description="Your numbers and your own rules, before you click. No market calls — only arithmetic on your inputs and your own history."
      />
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <form onSubmit={submit} className="space-y-4">
          <Card>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Direction">
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-strong bg-surface p-0.5">
                    {(['long', 'short'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setF({ ...f, direction: d })}
                        className={cn(
                          'flex h-8 items-center justify-center gap-1 rounded-md text-sm font-medium capitalize',
                          f.direction === d
                            ? d === 'long'
                              ? 'bg-go-soft text-go'
                              : 'bg-stop-soft text-stop'
                            : 'text-fg-muted hover:text-fg',
                        )}
                      >
                        {d === 'long' ? (
                          <ArrowUpRight className="size-4" />
                        ) : (
                          <ArrowDownRight className="size-4" />
                        )}
                        {d}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Instrument">
                  <Input
                    value={f.instrument}
                    onChange={(e) => setF({ ...f, instrument: e.target.value.toUpperCase() })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Entry" error={errors.entry}>
                  <Input
                    ref={entryRef}
                    type="number"
                    step="any"
                    value={f.entry}
                    onChange={(e) => setF({ ...f, entry: e.target.value })}
                    invalid={!!errors.entry}
                    data-testid="pc-entry"
                  />
                </Field>
                <Field label="Stop" error={errors.stop}>
                  <Input
                    type="number"
                    step="any"
                    value={f.stop}
                    onChange={(e) => setF({ ...f, stop: e.target.value })}
                    invalid={!!errors.stop}
                    data-testid="pc-stop"
                  />
                </Field>
                <Field label="Target" error={errors.target}>
                  <Input
                    type="number"
                    step="any"
                    value={f.target}
                    placeholder="optional"
                    onChange={(e) => setF({ ...f, target: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Setup">
                  <Input
                    list="pc-setups"
                    value={f.setupTag}
                    onChange={(e) => setF({ ...f, setupTag: e.target.value })}
                    placeholder="your label"
                  />
                  <datalist id="pc-setups">
                    {[...new Set([...(tags.data ?? []), ...account.traderRules.setups])].map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Risk %">
                  <Input
                    type="number"
                    step="0.05"
                    value={f.riskPct}
                    placeholder={String(defaultRisk)}
                    onChange={(e) => setF({ ...f, riskPct: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Why this trade, in one line?" error={errors.preNote}>
                <Input
                  value={f.preNote}
                  onChange={(e) => setF({ ...f, preNote: e.target.value })}
                  placeholder="Why this trade, in one line?"
                  maxLength={500}
                  invalid={!!errors.preNote}
                  data-testid="pc-note"
                />
              </Field>
              {run.error && !(run.error instanceof ApiError && run.error.details) && (
                <p className="text-sm text-stop">{errorText(run.error)}</p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={run.isPending}
                data-testid="pc-submit"
              >
                Check this trade <Kbd>↵</Kbd>
              </Button>
            </div>
          </Card>
          <Disclaimer />
        </form>

        <div className="min-w-0 space-y-5">
          {!r && !run.isPending && (
            <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong p-8 text-center">
              <Sigma className="size-6 text-fg-subtle" />
              <p className="mt-3 text-sm font-medium">Enter the trade you’re about to take</p>
              <p className="mt-1 max-w-sm text-sm text-fg-muted">
                You’ll get position size, reward:risk, what’s left of today’s loss limit, your own history for
                this setup, and a calm check on your current state.
              </p>
            </div>
          )}
          {run.isPending && <Spinner label="Checking…" />}
          {r && <Result r={r} currency={cur} onLog={() => nav(`/trades/new?precheck=${r.id}`)} />}
          {recent.data && recent.data.length > 0 && (
            <Card title="Recent checks" bodyClassName="p-0">
              <ul className="divide-y divide-line text-sm">
                {recent.data.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                    <Badge tone={p.verdict === 'go' ? 'go' : p.verdict === 'caution' ? 'caution' : 'stop'}>
                      {p.verdict.toUpperCase()}
                    </Badge>
                    <span className="num text-fg-muted">{fmtDateTime(p.createdAt)}</span>
                    <span className="flex-1 truncate">
                      {p.input.direction === 'long' ? 'Long' : 'Short'} {p.input.instrument} @ {p.input.entry}
                      {p.input.setupTag && <span className="text-fg-muted"> · {p.input.setupTag}</span>}
                    </span>
                    {p.linkedTradeId ? (
                      <Badge tone="accent">logged</Badge>
                    ) : (
                      <span className="text-xs text-fg-subtle">not taken</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Result({ r, currency, onLog }: { r: PrecheckDto; currency: string; onLog: () => void }) {
  const v = VERDICT[r.verdict];
  const c = r.computed;
  const h = c.history.stat;
  const order = { stop: 0, caution: 1, info: 2 } as const;
  return (
    <div className="space-y-5" data-testid="precheck-result">
      <div className={cn('flex items-start gap-4 rounded-[var(--radius-card)] border p-5', v.cls)}>
        <v.icon className="mt-0.5 size-7 shrink-0" />
        <div className="flex-1">
          <div className="text-lg font-semibold" data-testid="verdict">
            {v.label}
          </div>
          <div className="text-sm opacity-80">{v.sub}</div>
          <ul className="mt-3 space-y-1.5">
            {[...r.reasons]
              .sort((a, b) => order[a.level] - order[b.level])
              .map((x) => (
                <li key={x.code} className="flex items-start gap-2 text-sm text-fg">
                  {x.level === 'stop' ? (
                    <OctagonX className="mt-0.5 size-4 shrink-0 text-stop" />
                  ) : x.level === 'caution' ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
                  ) : (
                    <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  )}
                  {x.text}
                </li>
              ))}
          </ul>
        </div>
        <Button
          variant={r.verdict === 'stop' ? 'secondary' : 'primary'}
          icon={<ListPlus className="size-4" />}
          onClick={onLog}
          data-testid="log-from-check"
        >
          Log this trade
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Num
          label="Position size"
          value={`${fmtNum(c.positionSizeLots, 2)} lots`}
          sub={`risk ${fmtMoney(c.sizing.actualRisk, currency)} (${c.sizing.actualRiskPct.toFixed(2)}%)`}
          title={c.sizing.formula}
          testId="pc-size"
        />
        <Num
          label="Reward : risk"
          value={c.sizing.rewardRisk != null ? `${c.sizing.rewardRisk.toFixed(2)} : 1` : '—'}
          sub={c.sizing.rewardRisk != null ? 'target distance ÷ stop distance' : 'no target given'}
        />
        <Num
          label="Daily loss left after this trade"
          value={fmtMoney(c.dailyLossRemainingAfter, currency)}
          sub={`of ${fmtMoney(c.dailyLossRemaining, currency)} left today, if it hits the stop`}
          tone={
            c.exceedsDailyBudget
              ? 'stop'
              : c.dailyLossRemainingAfter < c.sizing.actualRisk
                ? 'caution'
                : undefined
          }
        />
        <Num
          label="Room to max-loss floor"
          value={fmtMoney(c.distanceToMaxLoss, currency)}
          sub={`floor ${fmtMoney(c.maxLossFloor, currency, 0)}`}
          tone={c.exceedsMaxLoss ? 'stop' : undefined}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Today, against your rules">
          <dl className="space-y-2.5 text-sm">
            <Row
              label="Trades today"
              value={`${c.tradesToday}${c.maxTradesPerDay ? ` / ${c.maxTradesPerDay}` : ''}`}
              warn={!!c.maxTradesPerDay && c.tradesToday >= c.maxTradesPerDay}
            />
            <Row
              label="Losses in a row today"
              value={`${c.consecutiveLossesToday}${c.stopAfterLosses ? ` / ${c.stopAfterLosses}` : ''}`}
              warn={!!c.stopAfterLosses && c.consecutiveLossesToday >= c.stopAfterLosses}
            />
            <Row
              label="Since last loss"
              value={fmtMinutes(c.minutesSinceLastLoss)}
              warn={c.minutesSinceLastLoss != null && c.minutesSinceLastLoss < c.cooldownMinutes}
            />
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <div className="text-[12px] font-medium text-fg-muted">
              Your history: “{c.history.setupTag ?? 'untagged'}” in the{' '}
              {c.session === 'ny'
                ? 'New York'
                : c.session === 'london'
                  ? 'London'
                  : c.session === 'asia'
                    ? 'Asia'
                    : 'off-hours'}{' '}
              session
            </div>
            {h ? (
              <div className="num mt-1.5 flex gap-5 text-sm">
                <span>n={h.n}</span>
                <span>win {fmtPct(h.winRate)}</span>
                <span>avg {fmtR(h.avgR)}</span>
                {h.nR < 10 && <span className="text-fg-subtle">small sample</span>}
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-fg-subtle">No history yet.</p>
            )}
          </div>
        </Card>
        <Card title="State check" subtitle="From your note and recent trades — never about the market">
          {r.jev.status === 'ok' ? (
            <dl className="space-y-2.5 text-sm">
              <Row
                label="Tilt risk"
                value={
                  <Badge
                    tone={
                      r.jev.tilt_risk!.uncertain
                        ? 'neutral'
                        : r.jev.tilt_risk!.score === 0
                          ? 'go'
                          : r.jev.tilt_risk!.score === 1
                            ? 'caution'
                            : 'stop'
                    }
                  >
                    {r.jev.tilt_risk!.value}
                    {r.jev.tilt_risk!.uncertain && ' · uncertain'}
                  </Badge>
                }
              />
              <Row
                label="Note matches one of your setups"
                value={
                  <Prob p={r.jev.matches_stated_setup!.p} uncertain={r.jev.matches_stated_setup!.uncertain} />
                }
              />
              <Row
                label="Reads like an impulse"
                value={<Prob p={r.jev.likely_impulse!.p} uncertain={r.jev.likely_impulse!.uncertain} />}
              />
            </dl>
          ) : (
            <p className="text-sm text-fg-muted">
              The state check couldn’t run just now. The verdict above uses your own rules only.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Prob({ p, uncertain }: { p: number; uncertain: boolean }) {
  if (uncertain) return <Badge>uncertain</Badge>;
  return (
    <span className="num">
      {p >= 0.65 ? 'Yes' : 'No'} <span className="text-fg-subtle">({Math.round(p * 100)}%)</span>
    </span>
  );
}

function Num({
  label,
  value,
  sub,
  tone,
  title,
  testId,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'stop' | 'caution';
  title?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5" title={title}>
      <div className="text-[12px] font-medium text-fg-muted">{label}</div>
      <div
        data-testid={testId}
        className={cn(
          'num mt-1 text-xl font-semibold',
          tone === 'stop' && 'text-stop',
          tone === 'caution' && 'text-caution',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-fg-subtle">{sub}</div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn('num font-medium', warn && 'text-caution')}>{value}</dd>
    </div>
  );
}
