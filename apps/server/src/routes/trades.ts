import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, gt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tradeInputSchema } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { prechecks, trades } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { parse } from '../lib/http.js';
import { ownedAccount, ownedTrade, isUuid } from '../services/scope.js';
import { buildTradeRow, tradeDto } from '../services/trades.js';
import { onTradesChanged } from '../services/labelling.js';

type IdParams = { Params: { id: string } };

const listQuery = z.object({
  accountId: z.uuid(),
  outcome: z.enum(['all', 'win', 'loss', 'open']).default('all'),
  setup: z.string().max(60).optional(),
  override: z.enum(['any', 'yes', 'no']).default('any'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = tradeInputSchema.and(z.object({ precheckId: z.uuid().optional() }));

export async function tradeRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  app.get('/api/trades', pre, async (req) => {
    const user = currentUser(req);
    const q = parse(listQuery, req.query);
    await ownedAccount(ctx.db, user.id, q.accountId);
    const where: SQL[] = [eq(trades.userId, user.id), eq(trades.accountId, q.accountId)];
    if (q.outcome === 'win') where.push(gt(trades.pnl, 0));
    if (q.outcome === 'loss') where.push(lt(trades.pnl, 0));
    if (q.outcome === 'open') where.push(isNull(trades.closedAt));
    if (q.setup) where.push(eq(trades.setupTag, q.setup));
    if (q.override === 'yes') where.push(eq(trades.overrideFlag, true));
    if (q.override === 'no') where.push(eq(trades.overrideFlag, false));
    if (q.from) where.push(gte(trades.openedAt, new Date(q.from)));
    if (q.to) where.push(lte(trades.openedAt, new Date(q.to)));
    const rows = await ctx.db
      .select()
      .from(trades)
      .where(and(...where))
      .orderBy(q.sort === 'newest' ? desc(trades.openedAt) : asc(trades.openedAt))
      .limit(q.limit)
      .offset(q.offset);
    const [count] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(...where));
    return { trades: rows.map(tradeDto), total: count?.n ?? 0 };
  });

  app.get('/api/trades/setup-tags', pre, async (req) => {
    const user = currentUser(req);
    const { accountId } = parse(z.object({ accountId: z.uuid().optional() }), req.query);
    const rows = await ctx.db
      .selectDistinct({ tag: trades.setupTag })
      .from(trades)
      .where(and(eq(trades.userId, user.id), isNotNull(trades.setupTag), accountId ? eq(trades.accountId, accountId) : undefined));
    return rows.map((r) => r.tag).filter(Boolean).sort();
  });

  app.post('/api/trades', pre, async (req) => {
    const user = currentUser(req);
    const body = parse(createBody, req.body);
    const account = await ownedAccount(ctx.db, user.id, body.accountId);
    const { row, warnings } = buildTradeRow(body, account, user);
    const trade = await ctx.db.transaction(async (tx) => {
      const [t] = await tx.insert(trades).values({ ...row, userId: user.id, accountId: account.id }).returning();
      if (body.precheckId && isUuid(body.precheckId)) {
        await tx
          .update(prechecks)
          .set({ linkedTradeId: t!.id })
          .where(and(eq(prechecks.id, body.precheckId), eq(prechecks.userId, user.id), eq(prechecks.accountId, account.id)));
      }
      await onTradesChanged(ctx, tx, user.id, [t!.id]);
      return t!;
    });
    return { trade: tradeDto(trade), warnings };
  });

  app.get<IdParams>('/api/trades/:id', pre, async (req) => {
    const user = currentUser(req);
    return tradeDto(await ownedTrade(ctx.db, user.id, req.params.id));
  });

  app.put<IdParams>('/api/trades/:id', pre, async (req) => {
    const user = currentUser(req);
    const existing = await ownedTrade(ctx.db, user.id, req.params.id);
    const body = parse(tradeInputSchema, req.body);
    const account = await ownedAccount(ctx.db, user.id, body.accountId);
    const { row, warnings } = buildTradeRow(body, account, user, existing.source);
    const trade = await ctx.db.transaction(async (tx) => {
      const [t] = await tx
        .update(trades)
        .set({ ...row, accountId: account.id })
        .where(and(eq(trades.id, existing.id), eq(trades.userId, user.id)))
        .returning();
      // Anything the classifier reads may have changed → re-label.
      await onTradesChanged(ctx, tx, user.id, [t!.id]);
      return t!;
    });
    return { trade: tradeDto(trade), warnings };
  });

  app.delete<IdParams>('/api/trades/:id', pre, async (req) => {
    const user = currentUser(req);
    await ownedTrade(ctx.db, user.id, req.params.id);
    await ctx.db.delete(trades).where(and(eq(trades.id, req.params.id), eq(trades.userId, user.id)));
    return { ok: true };
  });
}
