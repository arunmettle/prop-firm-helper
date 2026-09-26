import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx.js';
import { simulationRuns } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { notFound, parse } from '../lib/http.js';
import { isUuid, ownedAccount } from '../services/scope.js';
import { simulationDto, startSimulation } from '../services/simulation.js';

export async function simulationRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  app.post(
    '/api/simulations',
    { ...pre, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const user = currentUser(req);
      const body = parse(
        z.object({
          accountId: z.uuid(),
          runs: z.number().int().min(100).max(10_000).default(10_000),
          seed: z
            .number()
            .int()
            .min(0)
            .max(2 ** 31)
            .optional(),
        }),
        req.body,
      );
      const account = await ownedAccount(ctx.db, user.id, body.accountId);
      const run = await startSimulation(ctx, user.id, account, { runs: body.runs, seed: body.seed });
      return simulationDto(run, false);
    },
  );

  app.get('/api/simulations', pre, async (req) => {
    const user = currentUser(req);
    const { accountId } = parse(z.object({ accountId: z.uuid() }), req.query);
    await ownedAccount(ctx.db, user.id, accountId);
    const rows = await ctx.db
      .select()
      .from(simulationRuns)
      .where(and(eq(simulationRuns.userId, user.id), eq(simulationRuns.accountId, accountId)))
      .orderBy(desc(simulationRuns.createdAt))
      .limit(30);
    return rows.map((r) => simulationDto(r, false));
  });

  app.get<{ Params: { id: string } }>('/api/simulations/:id', pre, async (req) => {
    const user = currentUser(req);
    if (!isUuid(req.params.id)) throw notFound();
    const [row] = await ctx.db
      .select()
      .from(simulationRuns)
      .where(and(eq(simulationRuns.id, req.params.id), eq(simulationRuns.userId, user.id)))
      .limit(1);
    if (!row) throw notFound('Simulation not found');
    return simulationDto(row);
  });
}
