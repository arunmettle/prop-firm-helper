import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { jobs, type Job } from '../db/schema.js';
import type { AppCtx } from '../ctx.js';

export type JobKind = 'label_trades' | 'simulate';

export async function enqueue(db: Tx, kind: JobKind, payload: Record<string, unknown>, opts: { maxAttempts?: number } = {}) {
  const [job] = await db
    .insert(jobs)
    .values({ kind, payload, maxAttempts: opts.maxAttempts ?? 3 })
    .returning();
  return job!;
}

/** Atomically claim the next runnable job. Safe with many workers (FOR UPDATE SKIP LOCKED). */
export async function claimNext(db: Tx, kinds?: JobKind[]): Promise<Job | null> {
  const kindFilter = kinds?.length ? sql`and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const res = await db.execute(sql`
    update jobs set status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= now() ${kindFilter}
      order by run_after
      for update skip locked
      limit 1
    )
    returning id`);
  const id = (res.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  const row = await db.query.jobs.findFirst({ where: (j, { eq }) => eq(j.id, id) });
  return row ?? null;
}

/** Re-queue jobs whose worker died mid-run. */
export async function requeueStale(db: Tx, olderThanMinutes = 10) {
  await db.execute(sql`
    update jobs set status = 'queued', updated_at = now()
    where status = 'running' and locked_at < now() - (${olderThanMinutes} || ' minutes')::interval`);
}

export type JobHandler = (ctx: AppCtx, payload: Record<string, unknown>, job: Job) => Promise<void>;
export type FinalFailureHandler = (ctx: AppCtx, payload: Record<string, unknown>, error: string) => Promise<void>;

export interface HandlerSet {
  run: Record<string, JobHandler>;
  onFinalFailure?: Record<string, FinalFailureHandler>;
}

/** Process one job. Returns false when the queue is empty. */
export async function processNext(ctx: AppCtx, handlers: HandlerSet, kinds?: JobKind[]): Promise<boolean> {
  const job = await claimNext(ctx.db, kinds);
  if (!job) return false;
  const handler = handlers.run[job.kind];
  try {
    if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
    await handler(ctx, job.payload as Record<string, unknown>, job);
    await ctx.db.execute(sql`update jobs set status = 'done', last_error = null, updated_at = now() where id = ${job.id}`);
  } catch (err) {
    // Only the message is kept — job payloads hold ids, never note text.
    const message = err instanceof Error ? err.message : String(err);
    const final = job.attempts >= job.maxAttempts;
    const backoffSec = 2 ** job.attempts * 5;
    await ctx.db.execute(sql`
      update jobs set status = ${final ? 'failed' : 'queued'}, last_error = ${message.slice(0, 500)},
        run_after = now() + (${backoffSec} || ' seconds')::interval, updated_at = now()
      where id = ${job.id}`);
    if (final) await handlers.onFinalFailure?.[job.kind]?.(ctx, job.payload as Record<string, unknown>, message);
    console.error(`[jobs] ${job.kind} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`);
  }
  return true;
}

/** Drain the queue (used by tests and the e2e dev flow). */
export async function drain(ctx: AppCtx, handlers: HandlerSet, max = 1000) {
  for (let i = 0; i < max; i++) if (!(await processNext(ctx, handlers))) return i;
  return max;
}
