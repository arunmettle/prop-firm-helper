import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import Papa from 'papaparse';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, EyeOff, FileUp, ShieldCheck, Upload } from 'lucide-react';
import {
  CSV_FIELDS,
  CSV_FIELD_LABELS,
  CSV_REQUIRED,
  detectSensitiveColumns,
  guessMapping,
  mapCsvRow,
  type CsvField,
  type DroppedColumn,
} from '@cooldown/core';
import { api, errorText } from '../lib/api';
import { useMe } from '../lib/hooks';
import { useActiveAccount } from '../components/AccountSwitcher';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { fmtDateTime, fmtMoney } from '../lib/format';
import { cn } from '../lib/cn';

const TZ = ['UTC', 'Europe/Athens', 'Europe/Prague', 'Europe/London', 'America/New_York', 'Asia/Dubai'];

interface Parsed {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  dropped: DroppedColumn[];
}

export function ImportPage() {
  const { account } = useActiveAccount();
  const me = useMe();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<CsvField, string>>>({});
  const [tz, setTz] = useState('UTC');
  const [defaultInstrument, setDefaultInstrument] = useState('XAUUSD');
  const [parseError, setParseError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File) => {
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !res.data.length) {
          setParseError('That file has no rows we could read. Is it a CSV with a header row?');
          return;
        }
        const dropped = detectSensitiveColumns(headers, res.data);
        const allowed = headers.filter((h) => !dropped.some((d) => d.header === h));
        const saved = me.data?.settings.csvMapping ?? {};
        const savedValid = Object.fromEntries(Object.entries(saved).filter(([, h]) => allowed.includes(h)));
        setMapping({ ...guessMapping(allowed), ...savedValid });
        setParsed({ fileName: file.name, headers, rows: res.data, dropped });
      },
      error: (err) => setParseError(err.message),
    });
  };

  const allowed = parsed ? parsed.headers.filter((h) => !parsed.dropped.some((d) => d.header === h)) : [];
  const mapped = useMemo(
    () => (parsed ? parsed.rows.map((r) => mapCsvRow(r, mapping, { timezone: tz, defaultInstrument })) : []),
    [parsed, mapping, tz, defaultInstrument],
  );
  const valid = mapped.filter((m) => m.ok);
  const invalid = mapped.map((m, i) => ({ m, i })).filter((x) => !x.m.ok);
  const missingRequired = CSV_REQUIRED.filter((f) => !mapping[f]);

  const upload = useMutation({
    mutationFn: () =>
      api.post<{ inserted: number; duplicates: number; errors: { row: number; message: string }[] }>(
        '/api/import',
        {
          accountId: account!.id,
          // Only the whitelisted, mapped trade fields leave the browser.
          rows: valid.map((v) => (v.ok ? v.trade : null)).filter(Boolean),
          mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (!account) return <Spinner />;

  if (upload.data) {
    const r = upload.data;
    return (
      <>
        <PageHeader title="Import complete" />
        <Card>
          <div className="flex items-start gap-4">
            <div className="grid size-11 place-items-center rounded-xl bg-go-soft text-go">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="text-sm">
              <p className="text-[15px] font-semibold" data-testid="import-result">
                {r.inserted} trade{r.inserted === 1 ? '' : 's'} imported into {account.label}
              </p>
              <p className="mt-1 text-fg-muted">
                {r.duplicates} already existed and were skipped
                {r.errors.length ? ` · ${r.errors.length} rows rejected` : ''}. Notes are being classified in
                the background.
              </p>
              <div className="mt-4 flex gap-2">
                <Link to="/trades">
                  <Button variant="primary">View trades</Button>
                </Link>
                <Button
                  onClick={() => {
                    upload.reset();
                    setParsed(null);
                  }}
                >
                  Import another file
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Import CSV"
        description="Your file is read in this browser. Only the trade columns you map are sent — never account numbers, names or emails."
      />
      {!parsed ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) onFile(f);
          }}
          className={cn(
            'flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed px-6 py-20 text-center transition-colors',
            drag ? 'border-accent bg-accent-soft' : 'border-line-strong',
          )}
        >
          <div className="mb-4 grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-muted">
            <FileUp className="size-5" />
          </div>
          <p className="text-[15px] font-semibold">Drop a CSV export here</p>
          <p className="mt-1 text-sm text-fg-muted">
            MT4/MT5 history, cTrader, or a spreadsheet — one position per row.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            data-testid="csv-input"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button
            className="mt-5"
            variant="primary"
            icon={<Upload className="size-4" />}
            onClick={() => fileRef.current?.click()}
          >
            Choose file
          </Button>
          {parseError && <p className="mt-4 text-sm text-stop">{parseError}</p>}
          <p className="mt-8 flex items-center gap-1.5 text-xs text-fg-subtle">
            <ShieldCheck className="size-3.5" /> Parsed locally. Nothing is uploaded until you confirm.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Card
            title={parsed.fileName}
            subtitle={`${parsed.rows.length} rows · ${parsed.headers.length} columns`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setParsed(null)}>
                Choose another file
              </Button>
            }
          >
            {parsed.dropped.length > 0 ? (
              <div className="rounded-lg border border-caution/30 bg-caution-soft/50 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-caution">
                  <EyeOff className="size-4" /> {parsed.dropped.length} column
                  {parsed.dropped.length === 1 ? '' : 's'} will not be uploaded
                </div>
                <ul className="mt-2 space-y-1 text-sm" data-testid="dropped-columns">
                  {parsed.dropped.map((d) => (
                    <li key={d.header} className="text-fg-muted">
                      <span className="font-medium text-fg">{d.header}</span> — {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <ShieldCheck className="size-4 text-go" /> No personal or account columns detected.
              </p>
            )}
          </Card>

          <Card title="Map columns" subtitle="Saved for next time. Only mapped fields are sent.">
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
              {CSV_FIELDS.map((f) => (
                <Field
                  key={f}
                  label={
                    <>
                      {CSV_FIELD_LABELS[f]}
                      {CSV_REQUIRED.includes(f) && <span className="text-stop"> *</span>}
                    </>
                  }
                >
                  <Select
                    value={mapping[f] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}
                  >
                    <option value="">— not in file —</option>
                    {allowed.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              <Field label="Times in the file are in" hint="Broker server time is often UTC+2/+3.">
                <Select value={tz} onChange={(e) => setTz(e.target.value)}>
                  {TZ.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              </Field>
              {!mapping.instrument && (
                <Field label="Instrument for all rows">
                  <Input
                    value={defaultInstrument}
                    onChange={(e) => setDefaultInstrument(e.target.value.toUpperCase())}
                  />
                </Field>
              )}
            </div>
          </Card>

          <Card
            title="Preview"
            subtitle={
              missingRequired.length
                ? `Map required fields: ${missingRequired.map((f) => CSV_FIELD_LABELS[f]).join(', ')}`
                : `${valid.length} ready · ${invalid.length} with problems`
            }
            actions={
              <Button
                variant="primary"
                disabled={!valid.length || missingRequired.length > 0}
                loading={upload.isPending}
                onClick={() => upload.mutate()}
                data-testid="import-submit"
              >
                Import {valid.length} trade{valid.length === 1 ? '' : 's'}
              </Button>
            }
            bodyClassName="p-0"
          >
            {upload.error && <p className="px-5 pt-4 text-sm text-stop">{errorText(upload.error)}</p>}
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Opened</th>
                    <th className="px-3 py-2 font-medium">Trade</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Entry / Stop</th>
                    <th className="px-3 py-2 text-right font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&L</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mapped.slice(0, 12).map((m, i) => (
                    <tr key={i}>
                      <td className="num px-3 py-2 text-fg-subtle">{i + 1}</td>
                      {m.ok ? (
                        <>
                          <td className="num px-3 py-2 whitespace-nowrap">{fmtDateTime(m.trade.openedAt)}</td>
                          <td className="px-3 py-2">
                            {m.trade.direction === 'long' ? 'Long' : 'Short'} {m.trade.instrument}
                          </td>
                          <td className="num px-3 py-2 text-right">{m.trade.sizeLots}</td>
                          <td className="num px-3 py-2 text-right">
                            {m.trade.entryPrice} / {m.trade.stopPrice ?? '—'}
                          </td>
                          <td className="num px-3 py-2 text-right">{m.trade.exitPrice ?? '—'}</td>
                          <td className="num px-3 py-2 text-right">
                            {fmtMoney(m.trade.pnl ?? null, account.currency)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone="go">Ready</Badge>
                          </td>
                        </>
                      ) : (
                        <td colSpan={7} className="px-3 py-2 text-caution">
                          {m.error}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {mapped.length > 12 && (
                <p className="px-3 py-2 text-xs text-fg-subtle">…and {mapped.length - 12} more rows</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
