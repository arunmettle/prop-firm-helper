import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Trash2 } from 'lucide-react';
import {
  computeTradeMath,
  EXIT_LABELS,
  OVERRIDE_LABELS,
  suggestExitType,
  type ExitType,
  type OverrideKind,
} from '@cooldown/core';
import { api, ApiError, errorText } from '../lib/api';
import { useActiveAccount } from '../components/AccountSwitcher';
import { useMe } from '../lib/hooks';
import { fmtMoney, fmtR, toLocalInput } from '../lib/format';
import type { TradeDto } from '../lib/types';
import { Button, Card, Field, Input, Kbd, PageHeader, Select, Spinner, Textarea } from '../components/ui';

interface F {
  instrument: string;
  direction: 'long' | 'short';
  sizeLots: string;
  entryPrice: string;
  stopPrice: string;
  targetPrice: string;
  openedAt: string;
  closed: boolean;
  closedAt: string;
  exitPrice: string;
  pnl: string;
  exitType: ExitType;
  exitTouched: boolean;
  setupTag: string;
  preNote: string;
  overrideFlag: boolean;
  overrideKind: OverrideKind | '';
  overrideNote: string;
}

const empty = (): F => ({
  instrument: 'XAUUSD',
  direction: 'long',
  sizeLots: '',
  entryPrice: '',
  stopPrice: '',
  targetPrice: '',
  openedAt: toLocalInput(new Date()),
  closed: false,
  closedAt: toLocalInput(new Date()),
  exitPrice: '',
  pnl: '',
  exitType: 'open',
  exitTouched: false,
  setupTag: '',
  preNote: '',
  overrideFlag: false,
  overrideKind: '',
  overrideNote: '',
});

const n = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

export function TradeFormPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [search] = useSearchParams();
  const precheckId = search.get('precheck');
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const { account } = useActiveAccount();
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sizeRef = useRef<HTMLInputElement>(null);

  const existing = useQuery({ queryKey: ['trade', id], queryFn: () => api.get<TradeDto>(`/api/trades/${id}`), enabled: !isNew });
  const precheck = useQuery({
    queryKey: ['precheck', precheckId],
    queryFn: () => api.get<{ input: Record<string, unknown>; computed: { positionSizeLots: number | null } }>(`/api/prechecks/${precheckId}`),
    enabled: isNew && !!precheckId,
  });
  const tags = useQuery({
    queryKey: ['setup-tags', account?.id],
    queryFn: () => api.get<string[]>(`/api/trades/setup-tags?accountId=${account!.id}`),
    enabled: !!account,
  });

  useEffect(() => {
    const t = existing.data;
    if (!t) return;
    setF({
      instrument: t.instrument,
      direction: t.direction,
      sizeLots: String(t.sizeLots),
      entryPrice: String(t.entryPrice),
      stopPrice: t.stopPrice?.toString() ?? '',
      targetPrice: t.targetPrice?.toString() ?? '',
      openedAt: toLocalInput(t.openedAt),
      closed: !!t.closedAt,
      closedAt: toLocalInput(t.closedAt ?? new Date()),
      exitPrice: t.exitPrice?.toString() ?? '',
      pnl: t.source === 'csv' || (t.exitPrice === null && t.pnl !== null) ? (t.pnl?.toString() ?? '') : '',
      exitType: t.exitType,
      exitTouched: true,
      setupTag: t.setupTag ?? '',
      preNote: t.preNote ?? '',
      overrideFlag: t.overrideFlag,
      overrideKind: t.overrideKind ?? '',
      overrideNote: t.overrideNote ?? '',
    });
  }, [existing.data]);

  useEffect(() => {
    const p = precheck.data;
    if (!p) return;
    const i = p.input as { instrument: string; direction: 'long' | 'short'; entry: number; stop: number; target: number | null; setupTag: string | null; preNote: string };
    setF((s) => ({
      ...s,
      instrument: i.instrument,
      direction: i.direction,
      entryPrice: String(i.entry),
      stopPrice: String(i.stop),
      targetPrice: i.target?.toString() ?? '',
      setupTag: i.setupTag ?? '',
      preNote: i.preNote,
      sizeLots: p.computed.positionSizeLots?.toString() ?? '',
    }));
  }, [precheck.data]);

  useEffect(() => {
    if (isNew) sizeRef.current?.focus();
  }, [isNew]);

  const suggested = suggestExitType({
    direction: f.direction,
    entryPrice: n(f.entryPrice) ?? 0,
    stopPrice: n(f.stopPrice),
    targetPrice: n(f.targetPrice),
    exitPrice: n(f.exitPrice),
    closedAt: f.closed ? f.closedAt : null,
  });
  const exitType: ExitType = f.closed ? (f.exitTouched && f.exitType !== 'open' ? f.exitType : suggested === 'open' ? 'manual_close' : suggested) : 'open';

  const math = useMemo(() => {
    if (!account || n(f.entryPrice) === null || n(f.sizeLots) === null) return null;
    return computeTradeMath(
      {
        instrument: f.instrument,
        direction: f.direction,
        sizeLots: n(f.sizeLots)!,
        entryPrice: n(f.entryPrice)!,
        stopPrice: n(f.stopPrice),
        exitPrice: f.closed ? n(f.exitPrice) : null,
        closedAt: f.closed ? f.closedAt : null,
        pnl: f.closed ? n(f.pnl) : null,
      },
      account.currency,
      me.data?.settings.instruments ?? {},
    );
  }, [account, f, me.data]);
  const rr =
    n(f.targetPrice) !== null && n(f.stopPrice) !== null && n(f.entryPrice) !== null
      ? Math.abs(n(f.targetPrice)! - n(f.entryPrice)!) / Math.abs(n(f.entryPrice)! - n(f.stopPrice)!)
      : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        accountId: account!.id,
        instrument: f.instrument,
        direction: f.direction,
        sizeLots: n(f.sizeLots),
        entryPrice: n(f.entryPrice),
        stopPrice: n(f.stopPrice),
        targetPrice: n(f.targetPrice),
        openedAt: new Date(f.openedAt).toISOString(),
        closedAt: f.closed ? new Date(f.closedAt).toISOString() : null,
        exitPrice: f.closed ? n(f.exitPrice) : null,
        pnl: f.closed ? n(f.pnl) : null,
        exitType,
        setupTag: f.setupTag.trim() || null,
        preNote: f.preNote.trim() || null,
        overrideFlag: f.overrideFlag,
        overrideKind: f.overrideFlag ? f.overrideKind || null : null,
        overrideNote: f.overrideFlag ? f.overrideNote.trim() || null : null,
        ...(precheckId && isNew ? { precheckId } : {}),
      };
      return isNew ? api.post('/api/trades', body) : api.put(`/api/trades/${id}`, body);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['trades'] }),
        qc.invalidateQueries({ queryKey: ['status'] }),
        qc.invalidateQueries({ queryKey: ['setup-tags'] }),
        qc.invalidateQueries({ queryKey: ['trade'] }),
        qc.invalidateQueries({ queryKey: ['profile'] }),
      ]);
      nav('/trades');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details) {
        setErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
        setFormError('Please fix the highlighted fields.');
      } else setFormError(errorText(e));
    },
  });

  const del = useMutation({
    mutationFn: () => api.del(`/api/trades/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/trades');
    },
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setErrors({});
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!f.preNote.trim() && isNew) errs.preNote = 'One line on why — written before entry.';
    if (n(f.sizeLots) === null) errs.sizeLots = 'Required';
    if (n(f.entryPrice) === null) errs.entryPrice = 'Required';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    save.mutate();
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!account) return <Spinner />;
  if (!isNew && existing.isLoading) return <Spinner />;
  const cur = account.currency;
  const set = <K extends keyof F>(k: K) => (v: F[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <form ref={formRef} onSubmit={submit}>
      <PageHeader
        title={isNew ? 'Log trade' : 'Edit trade'}
        description={isNew ? (precheckId ? 'Pre-filled from your pre-trade check.' : 'A few fields and one honest line. Under 10 seconds.') : undefined}
        actions={
          <>
            {!isNew && (
              <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => confirm('Delete this trade?') && del.mutate()}>
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => nav(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save trade <Kbd>⌘↵</Kbd>
            </Button>
          </>
        }
      />
      {formError && <p className="mb-4 rounded-lg border border-stop/30 bg-stop-soft px-3 py-2 text-sm text-stop">{formError}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
              <Field label="Direction" className="col-span-2">
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-line-strong bg-surface p-0.5">
                  {(['long', 'short'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set('direction')(d)}
                      className={clsx(
                        'flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium capitalize transition-colors',
                        f.direction === d ? (d === 'long' ? 'bg-go-soft text-go' : 'bg-stop-soft text-stop') : 'text-fg-muted hover:text-fg',
                      )}
                    >
                      {d === 'long' ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Instrument" className="col-span-2">
                <Input value={f.instrument} onChange={(e) => set('instrument')(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Size (lots)" error={errors.sizeLots} className="col-span-2">
                <Input ref={sizeRef} type="number" step="any" min="0" value={f.sizeLots} onChange={(e) => set('sizeLots')(e.target.value)} invalid={!!errors.sizeLots} />
              </Field>
              <Field label="Entry" error={errors.entryPrice} className="col-span-2">
                <Input type="number" step="any" value={f.entryPrice} onChange={(e) => set('entryPrice')(e.target.value)} invalid={!!errors.entryPrice} />
              </Field>
              <Field label="Stop" error={errors.stopPrice} className="col-span-2">
                <Input type="number" step="any" value={f.stopPrice} onChange={(e) => set('stopPrice')(e.target.value)} invalid={!!errors.stopPrice} />
              </Field>
              <Field label="Target (optional)" error={errors.targetPrice} className="col-span-2">
                <Input type="number" step="any" value={f.targetPrice} onChange={(e) => set('targetPrice')(e.target.value)} />
              </Field>
              <Field label="Opened at" error={errors.openedAt} className="col-span-2">
                <Input type="datetime-local" value={f.openedAt} onChange={(e) => set('openedAt')(e.target.value)} />
              </Field>
              <Field label="Setup" className="col-span-4" hint="Your own label. Autocompletes from history.">
                <Input list="setup-tags" value={f.setupTag} onChange={(e) => set('setupTag')(e.target.value)} placeholder="e.g. breakout" />
                <datalist id="setup-tags">
                  {[...new Set([...(tags.data ?? []), ...account.traderRules.setups])].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field label="Why this trade, in one line?" error={errors.preNote} className="col-span-2 md:col-span-6">
                <Input
                  value={f.preNote}
                  onChange={(e) => set('preNote')(e.target.value)}
                  placeholder="Why this trade, in one line?"
                  maxLength={500}
                  invalid={!!errors.preNote}
                />
              </Field>
            </div>
          </Card>

          <Card
            title={
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={f.closed} onChange={(e) => set('closed')(e.target.checked)} />
                Trade is closed
              </label>
            }
            collapsed={!f.closed}
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Closed at" error={errors.closedAt}>
                <Input type="datetime-local" value={f.closedAt} onChange={(e) => set('closedAt')(e.target.value)} />
              </Field>
              <Field label="Exit price" error={errors.exitPrice}>
                <Input type="number" step="any" value={f.exitPrice} onChange={(e) => set('exitPrice')(e.target.value)} />
              </Field>
              <Field label="How it closed" error={errors.exitType}>
                <Select
                  value={exitType}
                  onChange={(e) => setF((s) => ({ ...s, exitType: e.target.value as ExitType, exitTouched: true }))}
                >
                  {(['target', 'stop', 'manual_close', 'breakeven'] as const).map((x) => (
                    <option key={x} value={x}>
                      {EXIT_LABELS[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Net P&L (${cur}, optional)`} hint="Overrides price-based P&L (e.g. after fees).">
                <Input type="number" step="0.01" value={f.pnl} onChange={(e) => set('pnl')(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card
            title={
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="size-4 accent-[var(--color-caution)]" checked={f.overrideFlag} onChange={(e) => set('overrideFlag')(e.target.checked)} />
                I changed my plan during this trade
              </label>
            }
            subtitle="Moved a stop, closed early, added size… Honest flags make your profile useful."
            collapsed={!f.overrideFlag}
          >
            <div className="flex flex-wrap gap-2">
              {(Object.keys(OVERRIDE_LABELS) as OverrideKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set('overrideKind')(k)}
                  className={clsx(
                    'h-8 rounded-lg border px-3 text-sm transition-colors',
                    f.overrideKind === k ? 'border-caution/50 bg-caution-soft text-caution' : 'border-line-strong text-fg-muted hover:text-fg',
                  )}
                >
                  {OVERRIDE_LABELS[k]}
                </button>
              ))}
            </div>
            {errors.overrideKind && <p className="mt-2 text-xs text-stop">{errors.overrideKind}</p>}
            <Textarea className="mt-4 min-h-16" placeholder="What made you change it? (optional)" value={f.overrideNote} onChange={(e) => set('overrideNote')(e.target.value)} maxLength={500} />
          </Card>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <Card title="Computed" subtitle="From your inputs only">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Risk</dt>
                <dd className="num font-medium">{fmtMoney(math?.riskAmount, cur)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Risk % of starting balance</dt>
                <dd className="num font-medium">{math?.riskAmount != null ? `${((math.riskAmount / account.startingBalance) * 100).toFixed(2)}%` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Reward : risk</dt>
                <dd className="num font-medium">{rr != null && Number.isFinite(rr) ? `${rr.toFixed(2)} : 1` : '—'}</dd>
              </div>
              {f.closed && (
                <>
                  <div className="my-2 border-t border-line" />
                  <div className="flex justify-between">
                    <dt className="text-fg-muted">P&L</dt>
                    <dd className={clsx('num font-semibold', (math?.pnl ?? 0) > 0 ? 'text-go' : (math?.pnl ?? 0) < 0 ? 'text-stop' : '')}>
                      {fmtMoney(math?.pnl, cur)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-fg-muted">R multiple</dt>
                    <dd className="num font-semibold">{fmtR(math?.rMultiple)}</dd>
                  </div>
                </>
              )}
            </dl>
            {math?.formula && <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-fg-subtle">{math.formula}</p>}
            {math?.warnings.map((w) => (
              <p key={w} className="mt-2 text-[11px] text-caution">
                {w}
              </p>
            ))}
          </Card>
        </aside>
      </div>
    </form>
  );
}
