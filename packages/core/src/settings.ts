import { z } from 'zod';
import { isValidTimeZone } from './time.js';

export const instrumentOverrideSchema = z.object({
  contractSize: z.number().positive().optional(),
  /** Account-currency value of a 1.0 price move for 1 lot. Overrides contractSize-based math. */
  valuePerPoint: z.number().positive().optional(),
});

export const csvMappingSchema = z.record(z.string(), z.string());

export const userSettingsSchema = z.object({
  keepRawNotes: z.boolean().default(true),
  defaultRiskPct: z.number().positive().max(10).default(1),
  timezone: z.string().refine(isValidTimeZone, 'Unknown time zone').default('UTC'),
  instruments: z.record(z.string(), instrumentOverrideSchema).default({}),
  /** Saved CSV column mapping: app field → CSV header. */
  csvMapping: csvMappingSchema.nullable().default(null),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const parseUserSettings = (raw: unknown): UserSettings => userSettingsSchema.parse(raw ?? {});

export const traderRulesSchema = z.object({
  riskPct: z.number().positive().max(10).default(1),
  maxTradesPerDay: z.number().int().positive().max(100).nullable().default(3),
  stopAfterLosses: z.number().int().positive().max(20).nullable().default(2),
  tradingDaysPerWeek: z.number().int().min(1).max(7).default(5),
  /** Minutes after a loss that count as "soon after a loss". */
  cooldownMinutes: z.number().int().positive().max(1440).default(30),
  /** The trader's own setup names/rules, used to check whether a note describes a planned setup. */
  setups: z.array(z.string().min(1).max(80)).max(30).default([]),
});
export type TraderRules = z.infer<typeof traderRulesSchema>;
export const parseTraderRules = (raw: unknown): TraderRules => traderRulesSchema.parse(raw ?? {});

export const DISCLAIMER =
  'Based on your own past trades. Past performance does not predict future results. Not financial advice.';
