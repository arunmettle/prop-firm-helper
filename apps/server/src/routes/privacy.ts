import { eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseUserSettings } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import {
  accounts,
  behaviourProfiles,
  creditsLedger,
  jevUsage,
  jobs,
  loginTokens,
  prechecks,
  sessions,
  simulationRuns,
  trades,
  users,
} from '../db/schema.js';
import { currentUser, requireUser, SESSION_COOKIE } from '../lib/auth.js';
import { parse } from '../lib/http.js';
import { tradeDto } from '../services/trades.js';
import { accountDto } from '../services/accounts.js';

const CSV_COLUMNS = [
  'id',
  'accountId',
  'instrument',
  'direction',
  'sizeLots',
  'entryPrice',
  'stopPrice',
  'targetPrice',
  'openedAt',
  'closedAt',
  'exitPrice',
  'pnl',
  'riskAmount',
  'rMultiple',
  'exitType',
  'setupTag',
  'preNote',
  'overrideFlag',
  'overrideKind',
  'overrideNote',
  'source',
] as const;

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function privacyRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  /** Everything we hold about the user, as JSON. */
  app.get('/api/export.json', pre, async (req, reply) => {
    const user = currentUser(req);
    const [acc, tr, pcs, sims, ledger, usage] = await Promise.all([
      ctx.db.select().from(accounts).where(eq(accounts.userId, user.id)),
      ctx.db.select().from(trades).where(eq(trades.userId, user.id)),
      ctx.db.select().from(prechecks).where(eq(prechecks.userId, user.id)),
      ctx.db.select().from(simulationRuns).where(eq(simulationRuns.userId, user.id)),
      ctx.db.select().from(creditsLedger).where(eq(creditsLedger.userId, user.id)),
      ctx.db.select().from(jevUsage).where(eq(jevUsage.userId, user.id)),
    ]);
    reply.header(
      'Content-Disposition',
      `attachment; filename="cooldown-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return {
      exportedAt: new Date().toISOString(),
      user: { email: user.email, createdAt: user.createdAt, settings: parseUserSettings(user.settings) },
      accounts: acc.map(accountDto),
      trades: tr.map(tradeDto),
      prechecks: pcs.map((p) => ({
        id: p.id,
        accountId: p.accountId,
        createdAt: p.createdAt,
        input: p.input,
        computed: p.computed,
        jev: p.jev,
        verdict: p.verdict,
        linkedTradeId: p.linkedTradeId,
      })),
      simulations: sims.map((s) => ({
        id: s.id,
        accountId: s.accountId,
        createdAt: s.createdAt,
        status: s.status,
        config: s.config,
        result: s.result,
      })),
      creditsLedger: ledger.map((l) => ({ delta: l.delta, reason: l.reason, createdAt: l.createdAt })),
      modelUsage: usage.map((u) => ({
        day: u.day,
        calls: u.calls,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      })),
    };
  });

  app.get('/api/export/trades.csv', pre, async (req, reply) => {
    const user = currentUser(req);
    const rows = (await ctx.db.select().from(trades).where(eq(trades.userId, user.id))).map(tradeDto);
    const body =
      [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join(
        '\n',
      ) + '\n';
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="cooldown-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return body;
  });

  /** Hard delete: every row belonging to the user, in ONE transaction. */
  app.post(
    '/api/me/delete',
    { ...pre, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = currentUser(req);
      parse(z.object({ confirm: z.literal('DELETE') }), req.body);
      await ctx.db.transaction(async (tx) => {
        const runIds = (
          await tx
            .select({ id: simulationRuns.id })
            .from(simulationRuns)
            .where(eq(simulationRuns.userId, user.id))
        ).map((r) => r.id);
        await tx
          .delete(jobs)
          .where(
            or(
              sql`${jobs.payload}->>'userId' = ${user.id}`,
              runIds.length ? inArray(sql`${jobs.payload}->>'runId'`, runIds) : sql`false`,
            ),
          );
        await tx.delete(prechecks).where(eq(prechecks.userId, user.id));
        await tx.delete(simulationRuns).where(eq(simulationRuns.userId, user.id));
        await tx.delete(behaviourProfiles).where(eq(behaviourProfiles.userId, user.id));
        await tx.delete(trades).where(eq(trades.userId, user.id));
        await tx.delete(accounts).where(eq(accounts.userId, user.id));
        await tx.delete(creditsLedger).where(eq(creditsLedger.userId, user.id));
        await tx.delete(jevUsage).where(eq(jevUsage.userId, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.delete(loginTokens).where(eq(loginTokens.email, user.email));
        await tx.delete(users).where(eq(users.id, user.id));
      });
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    },
  );
}
