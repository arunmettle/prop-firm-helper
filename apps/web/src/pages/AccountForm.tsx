import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, X } from 'lucide-react';
import {
  RULE_PRESETS,
  presetById,
  ruleSchema,
  traderRulesSchema,
  type Rules,
  type TraderRules,
} from '@cooldown/core';
import { api, errorText } from '../lib/api';
import { useActiveAccountId } from '../lib/hooks';
import type { AccountDto } from '../lib/types';
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../components/ui';

const TIMEZONES = [
  'UTC',
  'Europe/Prague',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
];

const defaultRules = (): Rules => ({ ...RULE_PRESETS[0]!.rules });
const defaultTrader = (): TraderRules => traderRulesSchema.parse({});

interface FormState {
  label: string;
  firmPreset: string | null;
  startingBalance: number;
  currency: string;
  startDate: string;
  status: 'active' | 'archived';
  rules: Rules;
  traderRules: TraderRules;
}

export function AccountFormPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const [, setActive] = useActiveAccountId();
  const existing = useQuery({
    queryKey: ['account', id],
    queryFn: () => api.get<AccountDto>(`/api/accounts/${id}`),
    enabled: !isNew,
  });
  const [f, setF] = useState<FormState>({
    label: '',
    firmPreset: RULE_PRESETS[0]!.id,
    startingBalance: 100_000,
    currency: 'USD',
    startDate: '',
    status: 'active',
    rules: defaultRules(),
    traderRules: defaultTrader(),
  });
  const [newSetup, setNewSetup] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = existing.data;
    if (a)
      setF({
        label: a.label,
        firmPreset: a.firmPreset,
        startingBalance: a.startingBalance,
        currency: a.currency,
        startDate: a.startDate ? a.startDate.slice(0, 10) : '',
        status: a.status,
        rules: a.rules,
        traderRules: a.traderRules,
      });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...f,
        startDate: f.startDate ? new Date(`${f.startDate}T00:00:00Z`).toISOString() : null,
        rules: ruleSchema.parse(f.rules),
        traderRules: traderRulesSchema.parse(f.traderRules),
      };
      return isNew
        ? api.post<AccountDto>('/api/accounts', body)
        : api.put<AccountDto>(`/api/accounts/${id}`, body);
    },
    onSuccess: async (a) => {
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      await qc.invalidateQueries({ queryKey: ['account'] });
      await qc.invalidateQueries({ queryKey: ['status'] });
      if (isNew) setActive(a.id);
      nav(isNew ? '/' : '/accounts');
    },
    onError: (e) => setError(errorText(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/accounts/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/accounts');
    },
  });

  if (!isNew && existing.isLoading) return <Spinner />;

  const setRule = <K extends keyof Rules>(k: K, v: Rules[K]) =>
    setF((s) => ({ ...s, rules: { ...s.rules, [k]: v } }));
  const setTR = <K extends keyof TraderRules>(k: K, v: TraderRules[K]) =>
    setF((s) => ({ ...s, traderRules: { ...s.traderRules, [k]: v } }));
  const applyPreset = (pid: string) => {
    const p = presetById(pid);
    setF((s) => ({ ...s, firmPreset: p ? p.id : null, rules: p ? { ...p.rules } : s.rules }));
  };
  const numOrNull = (v: string) => (v === '' ? null : Number(v));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };

  const preset = presetById(f.firmPreset);

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        title={isNew ? 'Add evaluation account' : 'Edit account'}
        description="Rules drive every number in Cooldown. Check them against your firm’s current terms."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => nav(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {isNew ? 'Create account' : 'Save changes'}
            </Button>
          </>
        }
      />
      {error && (
        <p className="rounded-lg border border-stop/30 bg-stop-soft px-3 py-2 text-sm text-stop">{error}</p>
      )}

      <Card title="Basics">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Label" className="md:col-span-2">
            <Input
              required
              value={f.label}
              onChange={(e) => setF({ ...f, label: e.target.value })}
              placeholder="e.g. 100k challenge — phase 1"
            />
          </Field>
          <Field label="Starting balance">
            <Input
              type="number"
              step="0.01"
              min="1"
              required
              value={f.startingBalance}
              onChange={(e) => setF({ ...f, startingBalance: Number(e.target.value) })}
            />
          </Field>
          <Field label="Currency">
            <Input
              maxLength={3}
              value={f.currency}
              onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Evaluation start date" hint="Anchors calendar-day limits. Optional.">
            <Input
              type="date"
              value={f.startDate}
              onChange={(e) => setF({ ...f, startDate: e.target.value })}
            />
          </Field>
          {!isNew && (
            <Field label="Status">
              <Select
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'archived' })}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card
        title="Evaluation rules"
        subtitle="Start from an example preset, then edit every field to match your firm."
      >
        <div className="mb-5 grid gap-3 md:grid-cols-3">
          {RULE_PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => applyPreset(p.id)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${f.firmPreset === p.id ? 'border-accent/60 bg-accent-soft' : 'border-line-strong hover:bg-surface-2'}`}
            >
              <div className="text-sm font-medium">{p.label}</div>
              <div className="num mt-1 text-xs text-fg-muted">
                +{p.rules.profitTargetPct}% · −{p.rules.maxDailyLossPct}%/day · −{p.rules.maxLossPct}%{' '}
                {p.rules.maxLossType.replace('_', ' ')}
              </div>
            </button>
          ))}
        </div>
        {preset && (
          <p className="mb-5 flex items-center gap-2 rounded-lg border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution">
            <AlertTriangle className="size-3.5 shrink-0" /> {preset.note}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Profit target (%)">
            <Input
              type="number"
              step="0.1"
              value={f.rules.profitTargetPct}
              onChange={(e) => setRule('profitTargetPct', Number(e.target.value))}
            />
          </Field>
          <Field label="Max daily loss (%)">
            <Input
              type="number"
              step="0.1"
              value={f.rules.maxDailyLossPct}
              onChange={(e) => setRule('maxDailyLossPct', Number(e.target.value))}
            />
          </Field>
          <Field label="Daily loss measured from">
            <Select
              value={f.rules.dailyLossBasis}
              onChange={(e) => setRule('dailyLossBasis', e.target.value as Rules['dailyLossBasis'])}
            >
              <option value="start_of_day_balance">Start-of-day balance</option>
              <option value="start_of_day_equity_or_balance_higher">
                Higher of start-of-day equity / balance
              </option>
            </Select>
          </Field>
          <Field label="Daily % is a % of">
            <Select
              value={f.rules.dailyLossAmountBasis}
              onChange={(e) =>
                setRule('dailyLossAmountBasis', e.target.value as Rules['dailyLossAmountBasis'])
              }
            >
              <option value="initial_balance">Initial balance (fixed amount)</option>
              <option value="day_start">That day’s starting level</option>
            </Select>
          </Field>
          <Field label="Max loss (%)">
            <Input
              type="number"
              step="0.1"
              value={f.rules.maxLossPct}
              onChange={(e) => setRule('maxLossPct', Number(e.target.value))}
            />
          </Field>
          <Field label="Max loss type">
            <Select
              value={f.rules.maxLossType}
              onChange={(e) => setRule('maxLossType', e.target.value as Rules['maxLossType'])}
            >
              <option value="static">Static</option>
              <option value="trailing_eod">Trailing (end of day)</option>
              <option value="trailing_intraday">Trailing (intraday, closed trades)</option>
            </Select>
          </Field>
          <Field
            label="Trailing floor stops at"
            hint={f.rules.maxLossType === 'static' ? 'Only used for trailing drawdown' : undefined}
          >
            <Select
              disabled={f.rules.maxLossType === 'static'}
              value={f.rules.trailingLockAt}
              onChange={(e) => setRule('trailingLockAt', e.target.value as Rules['trailingLockAt'])}
            >
              <option value="starting_balance">Starting balance</option>
              <option value="never">Never (keeps trailing)</option>
            </Select>
          </Field>
          <Field label="Day resets in time zone">
            <Select
              value={f.rules.dayResetTimezone}
              onChange={(e) => setRule('dayResetTimezone', e.target.value)}
            >
              {[...new Set([f.rules.dayResetTimezone, ...TIMEZONES])].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
          <Field label="Min trading days">
            <Input
              type="number"
              min="0"
              value={f.rules.minTradingDays}
              onChange={(e) => setRule('minTradingDays', Number(e.target.value))}
            />
          </Field>
          <Field label="Max calendar days" hint="Empty = unlimited">
            <Input
              type="number"
              min="1"
              value={f.rules.maxCalendarDays ?? ''}
              onChange={(e) => setRule('maxCalendarDays', numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Consistency rule (%)" hint="Best day ≤ X% of total profit. Empty = none">
            <Input
              type="number"
              min="1"
              max="100"
              value={f.rules.consistencyRulePct ?? ''}
              onChange={(e) => setRule('consistencyRulePct', numOrNull(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Your own rules"
        subtitle="Used by the pre-trade check and the simulator. Keep them honest, not aspirational."
      >
        <div className="grid gap-4 md:grid-cols-5">
          <Field label="Risk per trade (%)">
            <Input
              type="number"
              step="0.05"
              value={f.traderRules.riskPct}
              onChange={(e) => setTR('riskPct', Number(e.target.value))}
            />
          </Field>
          <Field label="Max trades per day">
            <Input
              type="number"
              min="1"
              value={f.traderRules.maxTradesPerDay ?? ''}
              onChange={(e) => setTR('maxTradesPerDay', numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Stop after N losses in a row">
            <Input
              type="number"
              min="1"
              value={f.traderRules.stopAfterLosses ?? ''}
              onChange={(e) => setTR('stopAfterLosses', numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Trading days / week">
            <Input
              type="number"
              min="1"
              max="7"
              value={f.traderRules.tradingDaysPerWeek}
              onChange={(e) => setTR('tradingDaysPerWeek', Number(e.target.value))}
            />
          </Field>
          <Field label="“Soon after a loss” (min)">
            <Input
              type="number"
              min="1"
              value={f.traderRules.cooldownMinutes}
              onChange={(e) => setTR('cooldownMinutes', Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="mt-5">
          <div className="mb-1.5 text-[12px] font-medium text-fg-muted">Your setups</div>
          <div className="flex flex-wrap gap-2">
            {f.traderRules.setups.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 py-1 pr-1.5 pl-2.5 text-sm"
              >
                {s}
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  onClick={() =>
                    setTR(
                      'setups',
                      f.traderRules.setups.filter((x) => x !== s),
                    )
                  }
                  className="rounded p-0.5 text-fg-subtle hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <div className="flex gap-2">
              <Input
                value={newSetup}
                placeholder="e.g. London breakout retest"
                className="w-60"
                onChange={(e) => setNewSetup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newSetup.trim();
                    if (v && !f.traderRules.setups.includes(v)) setTR('setups', [...f.traderRules.setups, v]);
                    setNewSetup('');
                  }
                }}
              />
              <Button
                type="button"
                icon={<Plus className="size-4" />}
                onClick={() => {
                  const v = newSetup.trim();
                  if (v && !f.traderRules.setups.includes(v)) setTR('setups', [...f.traderRules.setups, v]);
                  setNewSetup('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            Describe each setup in your own words — the pre-trade check compares your note against these.
          </p>
        </div>
      </Card>

      {!isNew && (
        <Card title="Danger zone">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-fg-muted">
              Deleting an account permanently deletes its trades, checks and simulations.
            </p>
            <Button
              type="button"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (confirm('Delete this account and all its trades? This cannot be undone.'))
                  remove.mutate();
              }}
            >
              Delete account
            </Button>
          </div>
        </Card>
      )}
    </form>
  );
}
