import type { UserSettings } from '../settings.js';

export interface InstrumentSpec {
  symbol: string;
  /** Units of the base asset per 1.0 lot (e.g. 100 oz for XAUUSD). */
  contractSize: number;
  /** Currency the price is quoted in. P&L is in this currency before conversion. */
  quoteCurrency: string;
  note?: string;
}

/** Defaults are config, not truth: brokers differ. Users can override per instrument in Settings. */
export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  XAUUSD: { symbol: 'XAUUSD', contractSize: 100, quoteCurrency: 'USD', note: '100 oz per lot' },
  XAGUSD: { symbol: 'XAGUSD', contractSize: 5000, quoteCurrency: 'USD', note: '5,000 oz per lot' },
  EURUSD: { symbol: 'EURUSD', contractSize: 100_000, quoteCurrency: 'USD' },
  GBPUSD: { symbol: 'GBPUSD', contractSize: 100_000, quoteCurrency: 'USD' },
  AUDUSD: { symbol: 'AUDUSD', contractSize: 100_000, quoteCurrency: 'USD' },
  USDJPY: { symbol: 'USDJPY', contractSize: 100_000, quoteCurrency: 'JPY' },
  US30: {
    symbol: 'US30',
    contractSize: 1,
    quoteCurrency: 'USD',
    note: 'Varies by broker — check your contract spec',
  },
  NAS100: {
    symbol: 'NAS100',
    contractSize: 1,
    quoteCurrency: 'USD',
    note: 'Varies by broker — check your contract spec',
  },
  US500: {
    symbol: 'US500',
    contractSize: 1,
    quoteCurrency: 'USD',
    note: 'Varies by broker — check your contract spec',
  },
};

export interface PointValue {
  /** Account-currency value of a 1.0 price move for 1.0 lot. */
  valuePerPoint: number;
  /** Human-readable explanation shown next to every computed number. */
  formula: string;
  source: 'override' | 'spec';
}

export type PointValueResult = { ok: true; value: PointValue } | { ok: false; reason: string };

export function normalizeSymbol(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function pointValue(
  instrument: string,
  accountCurrency: string,
  overrides: UserSettings['instruments'] = {},
): PointValueResult {
  const sym = normalizeSymbol(instrument);
  const o = overrides[sym];
  if (o?.valuePerPoint) {
    return {
      ok: true,
      value: {
        valuePerPoint: o.valuePerPoint,
        formula: `1.0 price move × 1 lot = ${o.valuePerPoint} ${accountCurrency} (your override)`,
        source: 'override',
      },
    };
  }
  const spec = INSTRUMENTS[sym];
  const contractSize = o?.contractSize ?? spec?.contractSize;
  if (!contractSize) {
    return {
      ok: false,
      reason: `No contract spec for ${sym}. Set its point value in Settings → Instruments.`,
    };
  }
  const quote = spec?.quoteCurrency ?? accountCurrency;
  if (quote.toUpperCase() !== accountCurrency.toUpperCase()) {
    return {
      ok: false,
      reason: `${sym} is quoted in ${quote} but the account is in ${accountCurrency}. Set a point value in ${accountCurrency} in Settings → Instruments.`,
    };
  }
  return {
    ok: true,
    value: {
      valuePerPoint: contractSize,
      formula: `1.0 price move × 1 lot = ${contractSize.toLocaleString('en-US')} ${accountCurrency} (contract size ${contractSize.toLocaleString('en-US')}${o?.contractSize ? ', your override' : ''})`,
      source: o?.contractSize ? 'override' : 'spec',
    },
  };
}
