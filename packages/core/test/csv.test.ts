import { describe, expect, it } from 'vitest';
import { detectSensitiveColumns, guessMapping, mapCsvRow, parseCsvDate, parseNumber, zonedWallTimeToUtc } from '../src/index.js';

describe('csv helpers', () => {
  it('guesses an MT4-style mapping', () => {
    const m = guessMapping(['Ticket', 'Open Time', 'Type', 'Size', 'Item', 'Price', 'S / L', 'T / P', 'Close Time', 'Close Price', 'Profit']);
    expect(m).toMatchObject({
      openedAt: 'Open Time',
      direction: 'Type',
      sizeLots: 'Size',
      instrument: 'Item',
      entryPrice: 'Price',
      stopPrice: 'S / L',
      targetPrice: 'T / P',
      closedAt: 'Close Time',
      exitPrice: 'Close Price',
      pnl: 'Profit',
    });
  });

  it('drops account numbers, names, emails and credentials', () => {
    const headers = ['Account', 'Login ID', 'Name', 'Email', 'Investor password', 'Broker ref', 'Symbol', 'Profit'];
    const rows = [
      { Account: '51234567', 'Login ID': '51234567', Name: 'Jo Bloggs', Email: 'x@y.com', 'Investor password': 'p', 'Broker ref': '98765432', Symbol: 'XAUUSD', Profit: '10' },
      { Account: '51234567', 'Login ID': '51234567', Name: 'Jo Bloggs', Email: 'x@y.com', 'Investor password': 'p', 'Broker ref': '98765432', Symbol: 'XAUUSD', Profit: '-5' },
    ];
    const d = detectSensitiveColumns(headers, rows).map((x) => x.header);
    expect(d).toEqual(['Account', 'Login ID', 'Name', 'Email', 'Investor password', 'Broker ref']);
  });

  it('drops any column whose values contain emails', () => {
    const d = detectSensitiveColumns(['Comment'], [{ Comment: 'sent to me@x.io' }]);
    expect(d[0]?.reason).toMatch(/email/);
  });

  it('keeps ordinary trade columns', () => {
    const d = detectSensitiveColumns(['Ticket', 'Symbol', 'Volume'], [
      { Ticket: '1001', Symbol: 'XAUUSD', Volume: '1' },
      { Ticket: '1002', Symbol: 'XAUUSD', Volume: '1' },
    ]);
    expect(d).toEqual([]);
  });

  it('parses numbers in common formats', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('-12,5')).toBe(-12.5);
    expect(parseNumber('(45.10)')).toBe(-45.1);
    expect(parseNumber('$ 1 000')).toBe(1000);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('parses dates in the chosen zone', () => {
    expect(parseCsvDate('2026.07.01 10:00:00', 'UTC')).toBe('2026-07-01T10:00:00.000Z');
    expect(parseCsvDate('2026.07.01 10:00', 'Europe/Athens')).toBe('2026-07-01T07:00:00.000Z');
    expect(parseCsvDate('2026-07-01T10:00:00Z', 'Europe/Athens')).toBe('2026-07-01T10:00:00.000Z');
    expect(parseCsvDate('01/07/2026 10:00', 'UTC')).toBe('2026-07-01T10:00:00.000Z');
    expect(parseCsvDate('nope', 'UTC')).toBeNull();
  });

  it('zoned wall time handles DST', () => {
    expect(zonedWallTimeToUtc({ y: 2026, m: 1, d: 15, h: 12 }, 'Europe/Prague').toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(zonedWallTimeToUtc({ y: 2026, m: 7, d: 15, h: 12 }, 'Europe/Prague').toISOString()).toBe('2026-07-15T10:00:00.000Z');
  });

  const mapping = guessMapping(['Open Time', 'Type', 'Size', 'Item', 'Price', 'S / L', 'T / P', 'Close Time', 'Close Price', 'Profit']);
  const opts = { timezone: 'UTC', defaultInstrument: 'XAUUSD' };
  const row = {
    'Open Time': '2026.07.01 10:00',
    Type: 'buy',
    Size: '0.50',
    Item: 'xauusd',
    Price: '2400',
    'S / L': '2390',
    'T / P': '2420',
    'Close Time': '2026.07.01 11:00',
    'Close Price': '2420',
    Profit: '1,000.00',
  };

  it('maps a full row', () => {
    const r = mapCsvRow(row, mapping, opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trade).toMatchObject({ instrument: 'XAUUSD', direction: 'long', sizeLots: 0.5, pnl: 1000, exitType: 'target' });
    }
  });

  it('treats a zero stop/target as none and drops a trailed stop past entry', () => {
    const r = mapCsvRow({ ...row, 'S / L': '0', 'T / P': '0' }, mapping, opts);
    expect(r.ok && r.trade.stopPrice).toBeNull();
    const t = mapCsvRow({ ...row, 'S / L': '2405' }, mapping, opts);
    expect(t.ok && t.trade.stopPrice).toBeNull();
  });

  it('reports a clear error for bad rows', () => {
    const r = mapCsvRow({ ...row, Type: 'balance' }, mapping, opts);
    expect(r.ok).toBe(false);
    const r2 = mapCsvRow({ ...row, Size: '' }, mapping, opts);
    expect(r2.ok).toBe(false);
  });
});
