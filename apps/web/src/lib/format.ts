export const fmtMoney = (v: number | null | undefined, currency = 'USD', dp = 2): string => {
  if (v == null || Number.isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(v);
};

export const fmtSignedMoney = (v: number | null | undefined, currency = 'USD'): string => {
  if (v == null) return '—';
  const s = fmtMoney(Math.abs(v), currency);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
};

export const fmtNum = (v: number | null | undefined, dp = 2): string =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const fmtR = (v: number | null | undefined, dp = 2): string =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}R`;

export const fmtPct = (v: number | null | undefined, dp = 0): string =>
  v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(dp)}%`;

export const fmtDateTime = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const fmtDate = (v: string | Date | null | undefined): string =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** datetime-local input value in the browser's local time. */
export const toLocalInput = (d: Date | string): string => {
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

export const signClass = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-fg' : v > 0 ? 'text-go' : 'text-stop';
