import { z } from 'zod';

export const directionSchema = z.enum(['long', 'short']);
export const exitTypeSchema = z.enum(['target', 'stop', 'manual_close', 'breakeven', 'open']);
export const overrideKindSchema = z.enum(['moved_stop', 'moved_target', 'closed_early', 'added_size', 'removed_stop']);
export type Direction = z.infer<typeof directionSchema>;
export type ExitType = z.infer<typeof exitTypeSchema>;
export type OverrideKind = z.infer<typeof overrideKindSchema>;

export const OVERRIDE_LABELS: Record<OverrideKind, string> = {
  moved_stop: 'Moved stop',
  moved_target: 'Moved target',
  closed_early: 'Closed early',
  added_size: 'Added size',
  removed_stop: 'Removed stop',
};

export const EXIT_LABELS: Record<ExitType, string> = {
  target: 'Target',
  stop: 'Stop',
  manual_close: 'Manual close',
  breakeven: 'Breakeven',
  open: 'Open',
};

const price = z.number().positive().finite();
const iso = z.iso.datetime({ offset: true });

export const tradeInputSchema = z
  .object({
    accountId: z.uuid(),
    instrument: z.string().trim().min(1).max(20).default('XAUUSD'),
    direction: directionSchema,
    sizeLots: z.number().positive().max(10_000),
    entryPrice: price,
    stopPrice: price.nullable().default(null),
    targetPrice: price.nullable().default(null),
    openedAt: iso,
    closedAt: iso.nullable().default(null),
    exitPrice: price.nullable().default(null),
    /** Optional manual P&L (account currency, net). When set it is used instead of the price-based P&L. */
    pnl: z.number().finite().nullable().default(null),
    exitType: exitTypeSchema.default('open'),
    setupTag: z.string().trim().max(60).nullable().default(null),
    preNote: z.string().trim().max(500).nullable().default(null),
    overrideFlag: z.boolean().default(false),
    overrideKind: overrideKindSchema.nullable().default(null),
    overrideNote: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((t, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const dir = t.direction === 'long' ? 1 : -1;
    if (t.stopPrice !== null && (t.stopPrice - t.entryPrice) * dir >= 0)
      add('stopPrice', t.direction === 'long' ? 'Stop must be below entry for a long' : 'Stop must be above entry for a short');
    if (t.targetPrice !== null && (t.targetPrice - t.entryPrice) * dir <= 0)
      add('targetPrice', t.direction === 'long' ? 'Target must be above entry for a long' : 'Target must be below entry for a short');
    if (t.closedAt) {
      if (new Date(t.closedAt) < new Date(t.openedAt)) add('closedAt', 'Close time is before open time');
      if (t.exitPrice === null && t.pnl === null) add('exitPrice', 'Enter an exit price or the P&L');
      if (t.exitType === 'open') add('exitType', 'Pick how the trade was closed');
    } else {
      if (t.exitType !== 'open') add('closedAt', 'Enter the close time for a closed trade');
    }
    if (t.overrideFlag && !t.overrideKind) add('overrideKind', 'Pick what you changed');
  });

export type TradeInput = z.infer<typeof tradeInputSchema>;
export type TradeInputRaw = z.input<typeof tradeInputSchema>;
