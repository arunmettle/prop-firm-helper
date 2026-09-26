import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { INSTRUMENTS, type UserSettings } from '@cooldown/core';
import { api, errorText } from '../lib/api';
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { cn } from '../lib/cn';

const TZ = [
  'UTC',
  'Europe/London',
  'Europe/Prague',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
];

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<UserSettings>('/api/settings') });
  const [s, setS] = useState<UserSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [newSym, setNewSym] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (next: UserSettings) => api.put<UserSettings>('/api/settings', next),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.post('/api/me/delete', { confirm: 'DELETE' }),
    onSuccess: () => {
      qc.clear();
      window.location.assign('/');
    },
  });
  if (!s) return <Spinner />;
  const setInstr = (sym: string, k: 'contractSize' | 'valuePerPoint', v: string) =>
    setS({
      ...s,
      instruments: {
        ...s.instruments,
        [sym]: { ...s.instruments[sym], [k]: v === '' ? undefined : Number(v) },
      },
    });

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(s)}>
            {saved ? 'Saved' : 'Save settings'}
          </Button>
        }
      />
      {save.error && <p className="mb-4 text-sm text-stop">{errorText(save.error)}</p>}
      <div className="space-y-5">
        <Card
          title="Your notes"
          subtitle="Notes are sent only to the note classifier, never pooled with other users and never used for training."
        >
          <label className="flex cursor-pointer items-start gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={s.keepRawNotes}
              onClick={() => setS({ ...s, keepRawNotes: !s.keepRawNotes })}
              className={cn(
                'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
                s.keepRawNotes ? 'bg-accent' : 'bg-surface-3',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0 size-5 rounded-full bg-white shadow transition-transform',
                  s.keepRawNotes ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
              />
            </button>
            <span className="text-sm">
              <span className="font-medium">Keep the text of my notes</span>
              <span className="mt-1 block text-fg-muted">
                On: you can reread your notes later. Off: after each note is classified, its text is deleted
                and only the labels (e.g. “plan”, “impulsive”) are kept. Turning this off applies to notes
                classified from now on.
              </span>
            </span>
          </label>
        </Card>

        <Card title="Defaults">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Default risk per trade (%)" hint="Used when an account has no risk rule">
              <Input
                type="number"
                step="0.05"
                value={s.defaultRiskPct}
                onChange={(e) => setS({ ...s, defaultRiskPct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Your time zone" hint="For display. Trading days use each account’s reset zone.">
              <Select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
                {[...new Set([s.timezone, ...TZ])].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card
          title="Instruments"
          subtitle="Contract specs differ by broker. Override them here — every size and risk number uses these."
        >
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="pb-2 font-medium">Symbol</th>
                <th className="pb-2 font-medium">Default</th>
                <th className="pb-2 font-medium">Contract size override</th>
                <th className="pb-2 font-medium">Value per 1.0 move per lot (account ccy)</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...new Set(['XAUUSD', ...Object.keys(s.instruments)])].map((sym) => (
                <tr key={sym}>
                  <td className="py-2 font-medium">{sym}</td>
                  <td className="py-2 text-fg-muted">
                    {INSTRUMENTS[sym]
                      ? `${INSTRUMENTS[sym].contractSize.toLocaleString()} (${INSTRUMENTS[sym].quoteCurrency})`
                      : 'none'}
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      step="any"
                      value={s.instruments[sym]?.contractSize ?? ''}
                      placeholder="—"
                      onChange={(e) => setInstr(sym, 'contractSize', e.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      step="any"
                      value={s.instruments[sym]?.valuePerPoint ?? ''}
                      placeholder="—"
                      onChange={(e) => setInstr(sym, 'valuePerPoint', e.target.value)}
                    />
                  </td>
                  <td className="py-2 text-right">
                    {s.instruments[sym] && (
                      <button
                        className="rounded p-1 text-fg-subtle hover:text-fg"
                        aria-label={`Remove ${sym} override`}
                        onClick={() => {
                          const next = { ...s.instruments };
                          delete next[sym];
                          setS({ ...s, instruments: next });
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <Input
              className="w-40"
              placeholder="e.g. NAS100"
              value={newSym}
              onChange={(e) => setNewSym(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => {
                if (newSym)
                  setS({ ...s, instruments: { ...s.instruments, [newSym]: s.instruments[newSym] ?? {} } });
                setNewSym('');
              }}
            >
              Add instrument
            </Button>
          </div>
        </Card>

        <Card title="Your data" subtitle="Everything we store about you, in open formats.">
          <div className="flex flex-wrap gap-2">
            <a href="/api/export.json" download>
              <Button icon={<Download className="size-4" />}>Export everything (JSON)</Button>
            </a>
            <a href="/api/export/trades.csv" download>
              <Button icon={<Download className="size-4" />}>Export trades (CSV)</Button>
            </a>
          </div>
          <ul className="mt-4 space-y-1.5 text-xs text-fg-muted">
            <li className="flex gap-2">
              <Lock className="size-3.5 shrink-0" /> We store only your email for identity. No broker logins,
              ever.
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="size-3.5 shrink-0" /> CSV files are read in your browser; only mapped
              trade columns are uploaded.
            </li>
          </ul>
        </Card>

        <Card title="Delete my account" className="border-stop/30">
          <p className="text-sm text-fg-muted">
            Permanently deletes your account, trades, notes, checks, simulations and credits. This cannot be
            undone.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              placeholder='Type "DELETE" to confirm'
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              disabled={confirm !== 'DELETE'}
              loading={del.isPending}
              onClick={() => del.mutate()}
            >
              Delete everything
            </Button>
          </div>
          {del.error && <p className="mt-2 text-sm text-stop">{errorText(del.error)}</p>}
        </Card>
      </div>
    </>
  );
}
