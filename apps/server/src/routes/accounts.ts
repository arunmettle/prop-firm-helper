import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accountInputSchema } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { accounts } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { parse } from '../lib/http.js';
import { accountDto, accountStatus } from '../services/accounts.js';
import { ownedAccount } from '../services/scope.js';

type IdParams = { Params: { id: string } };

export async function accountRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  app.get('/api/accounts', pre, async (req) => {
    const user = currentUser(req);
    const rows = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .orderBy(desc(accounts.createdAt));
    return rows.map(accountDto);
  });

  app.post('/api/accounts', pre, async (req) => {
    const user = currentUser(req);
    const input = parse(accountInputSchema, req.body);
    const [row] = await ctx.db
      .insert(accounts)
      .values({ ...input, userId: user.id, startDate: input.startDate ? new Date(input.startDate) : null })
      .returning();
    return accountDto(row!);
  });

  app.get<IdParams>('/api/accounts/:id', pre, async (req) => {
    const user = currentUser(req);
    return accountDto(await ownedAccount(ctx.db, user.id, req.params.id));
  });

  app.put<IdParams>('/api/accounts/:id', pre, async (req) => {
    const user = currentUser(req);
    await ownedAccount(ctx.db, user.id, req.params.id);
    const input = parse(accountInputSchema, req.body);
    const [row] = await ctx.db
      .update(accounts)
      .set({ ...input, startDate: input.startDate ? new Date(input.startDate) : null })
      .where(and(eq(accounts.id, req.params.id), eq(accounts.userId, user.id)))
      .returning();
    return accountDto(row!);
  });

  app.delete<IdParams>('/api/accounts/:id', pre, async (req) => {
    const user = currentUser(req);
    await ownedAccount(ctx.db, user.id, req.params.id);
    await ctx.db.delete(accounts).where(and(eq(accounts.id, req.params.id), eq(accounts.userId, user.id)));
    return { ok: true };
  });

  app.get<IdParams>('/api/accounts/:id/status', pre, async (req) => {
    const user = currentUser(req);
    const account = await ownedAccount(ctx.db, user.id, req.params.id);
    return accountStatus(ctx.db, account);
  });
}
