/** Timezone-aware day keys (YYYY-MM-DD) using Intl, no external deps. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Calendar day (in `tz`) that the instant `at` falls on, as YYYY-MM-DD. */
export function dayKey(at: Date | string | number, tz: string): string {
  const d = at instanceof Date ? at : new Date(at);
  const parts = formatter(tz).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days between two day keys (b - a). */
export function dayDiff(a: string, b: string): number {
  const pa = a.split('-').map(Number) as [number, number, number];
  const pb = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a day key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export type SessionName = 'asia' | 'london' | 'ny';

/** Session windows by UTC hour, [start, end). Overlaps resolve to the later session (London/NY overlap → NY). */
export interface SessionConfig {
  asia: [number, number];
  london: [number, number];
  ny: [number, number];
}

export const DEFAULT_SESSIONS: SessionConfig = { asia: [0, 7], london: [7, 12], ny: [12, 21] };

export function sessionOf(at: Date | string, cfg: SessionConfig = DEFAULT_SESSIONS): SessionName | 'off' {
  const h = (at instanceof Date ? at : new Date(at)).getUTCHours();
  const within = ([s, e]: [number, number]) => (s <= e ? h >= s && h < e : h >= s || h < e);
  if (within(cfg.ny)) return 'ny';
  if (within(cfg.london)) return 'london';
  if (within(cfg.asia)) return 'asia';
  return 'off';
}

export const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const offsetFmtCache = new Map<string, Intl.DateTimeFormat>();
/** Offset (minutes) of `tz` from UTC at instant `utcMs`. */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  let f = offsetFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return Math.round((asUtc - utcMs) / 60_000);
}

/** Interpret a wall-clock time in `tz` and return the UTC instant. */
export function zonedWallTimeToUtc(
  parts: { y: number; m: number; d: number; h?: number; mi?: number; s?: number },
  tz: string,
): Date {
  const naive = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h ?? 0, parts.mi ?? 0, parts.s ?? 0);
  // Two passes handle DST transitions.
  let utc = naive - tzOffsetMinutes(tz, naive) * 60_000;
  utc = naive - tzOffsetMinutes(tz, utc) * 60_000;
  return new Date(utc);
}
