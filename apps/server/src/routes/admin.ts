import { desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../ctx.js';
import { creditsLedger, jevUsage, jobs, simulationRuns, users } from '../db/schema.js';
import { currentUser, isAdmin, requireUser } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';

export async function adminRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = {
    preHandler: [
      requireUser(ctx),
      async (req: Parameters<ReturnType<typeof requireUser>>[0]) => {
        if (!isAdmin(ctx, currentUser(req))) throw new HttpError(404, 'Not found');
      },
    ],
  };

  /** Jev cost per user (last 30 days). Counters only — no content. */
  app.get('/api/admin/usage', pre, async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const rows = await ctx.db
      .select({
        email: users.email,
        calls: sql<number>`sum(${jevUsage.calls})::int`,
        failures: sql<number>`sum(${jevUsage.failures})::int`,
        inputTokens: sql<number>`sum(${jevUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${jevUsage.outputTokens})::int`,
        costUsd: sql<number>`(sum(${jevUsage.costMicros}) / 1000000.0)::float8`,
      })
      .from(jevUsage)
      .innerJoin(users, eq(users.id, jevUsage.userId))
      .where(gte(jevUsage.day, since))
      .groupBy(users.email)
      .orderBy(desc(sql`sum(${jevUsage.inputTokens})`));
    const [q] = await ctx.db
      .select({
        queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
        running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
      })
      .from(jobs);
    const [sims] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(simulationRuns);
    const [credits] = await ctx.db
      .select({
        sold: sql<number>`coalesce(sum(${creditsLedger.delta}) filter (where ${creditsLedger.reason} = 'purchase'), 0)::int`,
      })
      .from(creditsLedger);
    return {
      provider: ctx.jev.provider,
      users: rows,
      jobs: q,
      simulations: sims?.n ?? 0,
      creditsSold: credits?.sold ?? 0,
    };
  });
}
