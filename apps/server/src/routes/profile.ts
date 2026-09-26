import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCLAIMER } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { trades } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { parse } from '../lib/http.js';
import { ownedAccount } from '../services/scope.js';
import { computeProfile } from '../services/profile.js';
import { tradeDto } from '../services/trades.js';

export async function profileRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  app.get('/api/profile', pre, async (req) => {
    const user = currentUser(req);
    const { accountId } = parse(z.object({ accountId: z.uuid() }), req.query);
    const account = await ownedAccount(ctx.db, user.id, accountId);
    const profile = await computeProfile(ctx.db, account);
    const [pending] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(eq(trades.userId, user.id), eq(trades.accountId, accountId), eq(trades.labelsStatus, 'pending')));
    return { profile, labelsPending: pending?.n ?? 0, disclaimer: DISCLAIMER };
  });

  /** Evidence drill-down: fetch specific trades (always scoped to the signed-in user). */
  app.post('/api/trades/by-ids', pre, async (req) => {
    const user = currentUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(500) }), req.body);
    if (!ids.length) return [];
    const rows = await ctx.db
      .select()
      .from(trades)
      .where(and(eq(trades.userId, user.id), inArray(trades.id, ids)));
    return rows.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime()).map(tradeDto);
  });
}
