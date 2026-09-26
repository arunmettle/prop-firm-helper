import { zonedWallTimeToUtc } from '../time.js';
import { suggestExitType } from '../trades/compute.js';
import { normalizeSymbol } from '../trades/instruments.js';
import { tradeInputSchema, type TradeInputRaw } from '../trades/schema.js';

/** The ONLY fields that can leave the browser from a CSV. */
export const CSV_FIELDS = [
  'instrument',
  'direction',
  'sizeLots',
  'entryPrice',
  'stopPrice',
  'targetPrice',
  'openedAt',
  'closedAt',
  'exitPrice',
  'pnl',
  'setupTag',
  'preNote',
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  instrument: 'Instrument / symbol',
  direction: 'Direction (buy/sell)',
  sizeLots: 'Size (lots)',
  entryPrice: 'Entry price',
  stopPrice: 'Stop loss',
  targetPrice: 'Take profit',
  openedAt: 'Open time',
  closedAt: 'Close time',
  exitPrice: 'Exit price',
  pnl: 'Profit / P&L',
  setupTag: 'Setup / tag',
  preNote: 'Note / comment',
};

export const CSV_REQUIRED: CsvField[] = ['direction', 'sizeLots', 'entryPrice', 'openedAt'];

const SYNONYMS: Record<CsvField, RegExp> = {
  instrument: /^(symbol|instrument|item|market|pair|ticker|asset)$/i,
  direction: /^(type|side|direction|action|buy\/?sell|b\/s)$/i,
  sizeLots: /^(volume|lots?|size|qty|quantity|lot size)$/i,
  entryPrice: /^(open price|entry( price)?|price open|open|price|entry px)$/i,
  stopPrice: /^(s\s*\/\s*l|sl|stop( loss)?|stop price)$/i,
  targetPrice: /^(t\s*\/\s*p|tp|take profit|target( price)?)$/i,
  openedAt: /^(open time|opened( at)?|entry time|time open|open date|time|date)$/i,
  closedAt: /^(close time|closed( at)?|exit time|time close|close date)$/i,
  exitPrice: /^(close price|exit( price)?|price close|close|exit px)$/i,
  pnl: /^(profit|p\s*&\s*l|pnl|net( profit| p&l)?|result|gain)$/i,
  setupTag: /^(setup|tag|strategy|playbook)$/i,
  preNote: /^(comment|notes?|reason|journal)$/i,
};

export function guessMapping(headers: string[]): Partial<Record<CsvField, string>> {
  const out: Partial<Record<CsvField, string>> = {};
  const used = new Set<string>();
  for (const f of CSV_FIELDS) {
    const h = headers.find((x) => !used.has(x) && SYNONYMS[f].test(x.trim()));
    if (h) {
      out[f] = h;
      used.add(h);
    }
  }
  return out;
}

export interface DroppedColumn {
  header: string;
  reason: string;
}

const SENSITIVE_HEADER: [RegExp, string][] = [
  [/e-?mail/i, 'looks like an email column'],
  [/pass(word)?|investor|pin\b|secret|token|api.?key/i, 'looks like a credential'],
  [
    /\b(account|acct|acc)\b.*(no|num|number|id|#)?|^login$|login.?id|^account$/i,
    'looks like an account number',
  ],
  [
    /(^|\s|_)(name|first.?name|last.?name|full.?name|client|trader|owner|holder)($|\s|_)/i,
    'looks like a personal name',
  ],
  [/phone|mobile|address|iban|swift|bank|card/i, 'looks like personal or banking data'],
];

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Identify columns that must never be uploaded: account numbers, names, emails, credentials.
 * Conservative: when in doubt, drop — mapped trade fields are never dropped unless they contain emails.
 */
export function detectSensitiveColumns(headers: string[], rows: Record<string, string>[]): DroppedColumn[] {
  const sample = rows.slice(0, 200);
  const dropped: DroppedColumn[] = [];
  for (const h of headers) {
    const hit = SENSITIVE_HEADER.find(([re]) => re.test(h.trim()));
    if (hit) {
      dropped.push({ header: h, reason: hit[1] });
      continue;
    }
    const vals = sample.map((r) => (r[h] ?? '').trim()).filter(Boolean);
    if (!vals.length) continue;
    if (vals.some((v) => EMAIL_RE.test(v))) {
      dropped.push({ header: h, reason: 'contains email addresses' });
      continue;
    }
    // A constant 6–12 digit integer across all rows is almost certainly an account/login number.
    const distinct = new Set(vals);
    if (distinct.size === 1 && /^\d{6,12}$/.test(vals[0]!) && vals.length > 1) {
      dropped.push({ header: h, reason: 'same long number on every row (likely an account number)' });
    }
  }
  return dropped;
}

export interface CsvParseOptions {
  /** IANA zone the CSV's timestamps are written in (broker server time is often not UTC). */
  timezone: string;
  defaultInstrument: string;
}

export type MappedRow = { ok: true; trade: CsvTradeRow } | { ok: false; error: string };

/** Whitelisted shape actually sent to the server. */
export type CsvTradeRow = Pick<
  TradeInputRaw,
  | 'instrument'
  | 'direction'
  | 'sizeLots'
  | 'entryPrice'
  | 'stopPrice'
  | 'targetPrice'
  | 'openedAt'
  | 'closedAt'
  | 'exitPrice'
  | 'pnl'
  | 'exitType'
  | 'setupTag'
  | 'preNote'
>;

export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim().replace(/[\s$€£¥]/g, '');
  if (!s) return null;
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // "1.234,56" → 1234.56 ; "1,234.56" → 1234.56
  if (/,\d{1,2}$/.test(s) && s.includes('.') && s.indexOf('.') < s.lastIndexOf(','))
    s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDirection(raw: string | undefined): 'long' | 'short' | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (/^(buy|long|b|bull)(\s.*)?$/.test(s)) return 'long';
  if (/^(sell|short|s|bear)(\s.*)?$/.test(s)) return 'short';
  return null;
}

/** Accepts ISO 8601 (with or without offset), "YYYY.MM.DD HH:MM[:SS]", "YYYY-MM-DD HH:MM", "DD/MM/YYYY HH:MM". */
export function parseCsvDate(raw: string | undefined, tz: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    return zonedWallTimeToUtc(
      { y: +m[1]!, m: +m[2]!, d: +m[3]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) },
      tz,
    ).toISOString();
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    // Day-first (DD/MM/YYYY) — the common broker-statement convention outside the US. See DECISIONS.md.
    return zonedWallTimeToUtc(
      { y: +m[3]!, m: +m[2]!, d: +m[1]!, h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) },
      tz,
    ).toISOString();
  }
  return null;
}

export function mapCsvRow(
  row: Record<string, string>,
  mapping: Partial<Record<CsvField, string>>,
  opts: CsvParseOptions,
): MappedRow {
  const get = (f: CsvField) => (mapping[f] ? row[mapping[f]!] : undefined);
  const direction = parseDirection(get('direction'));
  if (!direction) return { ok: false, error: `Direction "${get('direction') ?? ''}" is not buy/sell` };
  const zeroToNull = (n: number | null) => (n === null || n === 0 ? null : n);
  const openedAt = parseCsvDate(get('openedAt'), opts.timezone);
  if (!openedAt) return { ok: false, error: 'Open time is missing or unreadable' };
  const closedAt = parseCsvDate(get('closedAt'), opts.timezone);
  const trade: CsvTradeRow = {
    instrument: normalizeSymbol(get('instrument') || opts.defaultInstrument),
    direction,
    sizeLots: parseNumber(get('sizeLots')) ?? NaN,
    entryPrice: parseNumber(get('entryPrice')) ?? NaN,
    stopPrice: zeroToNull(parseNumber(get('stopPrice'))),
    targetPrice: zeroToNull(parseNumber(get('targetPrice'))),
    openedAt,
    closedAt,
    exitPrice: closedAt ? zeroToNull(parseNumber(get('exitPrice'))) : null,
    pnl: closedAt ? parseNumber(get('pnl')) : null,
    setupTag: get('setupTag')?.trim().slice(0, 60) || null,
    preNote: get('preNote')?.trim().slice(0, 500) || null,
  };
  // Broker exports carry the FINAL stop/target. A stop at/through entry (trailed to breakeven or profit) says nothing
  // about initial risk, so we drop it rather than compute a wrong R. See RISKS.md.
  const dir = direction === 'long' ? 1 : -1;
  if (trade.stopPrice != null && (trade.stopPrice - trade.entryPrice) * dir >= 0) trade.stopPrice = null;
  if (trade.targetPrice != null && (trade.targetPrice - trade.entryPrice) * dir <= 0)
    trade.targetPrice = null;
  trade.exitType = suggestExitType({
    direction,
    entryPrice: trade.entryPrice,
    stopPrice: trade.stopPrice ?? null,
    targetPrice: trade.targetPrice ?? null,
    exitPrice: trade.exitPrice ?? null,
    closedAt: trade.closedAt,
  });
  if (trade.closedAt && trade.exitType === 'open') trade.exitType = 'manual_close';
  // Validate with the same schema the server uses (accountId placeholder).
  const check = tradeInputSchema.safeParse({ ...trade, accountId: '00000000-0000-4000-8000-000000000000' });
  if (!check.success) {
    const i = check.error.issues[0]!;
    return { ok: false, error: `${i.path.join('.') || 'row'}: ${i.message}` };
  }
  return { ok: true, trade };
}
