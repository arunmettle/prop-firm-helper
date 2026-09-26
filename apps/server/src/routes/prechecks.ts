import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { precheckInputSchema } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { prechecks } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { notFound, parse } from '../lib/http.js';
import { isUuid, ownedAccount } from '../services/scope.js';
import { precheckDto, recentPrechecks, runPrecheck } from '../services/precheck.js';

export async function precheckRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  // Calls Jev → rate limited per client.
  app.post('/api/prechecks', { ...pre, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const user = currentUser(req);
    const input = parse(precheckInputSchema, req.body);
    const account = await ownedAccount(ctx.db, user.id, input.accountId);
    return runPrecheck(ctx, user, account, input);
  });

  app.get('/api/prechecks', pre, async (req) => {
    const user = currentUser(req);
    const { accountId } = parse(z.object({ accountId: z.uuid() }), req.query);
    await ownedAccount(ctx.db, user.id, accountId);
    return recentPrechecks(ctx, user.id, accountId);
  });

  app.get<{ Params: { id: string } }>('/api/prechecks/:id', pre, async (req) => {
    const user = currentUser(req);
    if (!isUuid(req.params.id)) throw notFound();
    const [row] = await ctx.db
      .select()
      .from(prechecks)
      .where(and(eq(prechecks.id, req.params.id), eq(prechecks.userId, user.id)))
      .limit(1);
    if (!row) throw notFound('Check not found');
    return precheckDto(row);
  });
}
