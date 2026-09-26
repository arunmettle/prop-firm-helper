import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { csvMappingSchema, parseUserSettings, tradeInputSchema } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { trades, users } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { parse } from '../lib/http.js';
import { sha256 } from '../lib/crypto.js';
import { ownedAccount } from '../services/scope.js';
import { buildTradeRow } from '../services/trades.js';
import { onTradesChanged } from '../services/labelling.js';

/**
 * Whitelisted CSV row. `strictObject` rejects ANY extra key, so nothing but these trade fields can be uploaded
 * (the browser already strips everything else — this is the server-side guarantee).
 */
const csvRow = z.strictObject({
  instrument: z.string(),
  direction: z.enum(['long', 'short']),
  sizeLots: z.number(),
  entryPrice: z.number(),
  stopPrice: z.number().nullable(),
  targetPrice: z.number().nullable(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  exitPrice: z.number().nullable(),
  pnl: z.number().nullable(),
  exitType: z.enum(['target', 'stop', 'manual_close', 'breakeven', 'open']),
  setupTag: z.string().nullable(),
  preNote: z.string().nullable(),
});

const importBody = z.strictObject({
  accountId: z.uuid(),
  rows: z.array(csvRow).min(1).max(5000),
  mapping: csvMappingSchema.optional(),
});

/** Idempotency key: same instrument + open time + entry + size = same trade. */
export const importHash = (t: {
  instrument: string;
  openedAt: string;
  entryPrice: number;
  sizeLots: number;
}) =>
  sha256(`${t.instrument.toUpperCase()}|${new Date(t.openedAt).toISOString()}|${t.entryPrice}|${t.sizeLots}`);

export async function importRoutes(app: FastifyInstance, ctx: AppCtx) {
  app.post('/api/import', { preHandler: requireUser(ctx), bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const user = currentUser(req);
    const body = parse(importBody, req.body);
    const account = await ownedAccount(ctx.db, user.id, body.accountId);

    const errors: { row: number; message: string }[] = [];
    const values: (typeof trades.$inferInsert)[] = [];
    const seen = new Set<string>();
    let duplicatesInFile = 0;
    body.rows.forEach((r, i) => {
      const v = tradeInputSchema.safeParse({ ...r, accountId: account.id, overrideFlag: false });
      if (!v.success) {
        const iss = v.error.issues[0]!;
        errors.push({ row: i + 1, message: `${iss.path.join('.')}: ${iss.message}` });
        return;
      }
      const hash = importHash(v.data);
      if (seen.has(hash)) {
        duplicatesInFile++;
        return;
      }
      seen.add(hash);
      const { row } = buildTradeRow(v.data, account, user, 'csv');
      values.push({ ...row, userId: user.id, accountId: account.id, importHash: hash });
    });

    const inserted = await ctx.db.transaction(async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < values.length; i += 500) {
        const res = await tx
          .insert(trades)
          .values(values.slice(i, i + 500))
          .onConflictDoNothing({ target: [trades.userId, trades.importHash] })
          .returning({ id: trades.id });
        ids.push(...res.map((r) => r.id));
      }
      if (body.mapping) {
        const settings = parseUserSettings(user.settings);
        await tx
          .update(users)
          .set({ settings: { ...settings, csvMapping: body.mapping } })
          .where(eq(users.id, user.id));
      }
      await onTradesChanged(ctx, tx, user.id, ids);
      return ids;
    });

    return {
      inserted: inserted.length,
      duplicates: values.length - inserted.length + duplicatesInFile,
      errors,
    };
  });
}
