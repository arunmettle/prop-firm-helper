import { z } from 'zod';
import { ruleSchema } from './rules/schema.js';
import { traderRulesSchema } from './settings.js';

export const accountInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  firmPreset: z.string().max(60).nullable().default(null),
  startingBalance: z.number().positive().max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  rules: ruleSchema,
  traderRules: traderRulesSchema.default(traderRulesSchema.parse({})),
  startDate: z.iso.datetime({ offset: true }).nullable().default(null),
  status: z.enum(['active', 'archived']).default('active'),
});
export type AccountInput = z.infer<typeof accountInputSchema>;
