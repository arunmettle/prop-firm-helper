import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { simulationRuns } from '../src/db/schema.js';
import { runJobs, setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let b: string;
let accountId: string;
const credits = async (cookie: string) => (await env.app.inject({ url: '/api/me', headers: { cookie } })).json().credits;

beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'sim@example.com');
  b = await signIn(env, 'sim2@example.com');
  accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
  for (let i = 0; i < 8; i++) await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: tradeBody(accountId, i % 2 ? { exitPrice: 2390, exitType: 'stop' } : {}) });
  await runJobs(env);
});
afterAll(async () => env.close());

describe('simulations', () => {
  it('charges 1 credit in the same transaction that enqueues, then produces results', async () => {
    const before = await credits(a);
    const r = await env.app.inject({ method: 'POST', url: '/api/simulations', headers: { cookie: a }, payload: { accountId, runs: 300, seed: 7 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('queued');
    expect(await credits(a)).toBe(before - 1);
    const jobs = await env.ctx.db.execute(sql`select kind from jobs where status = 'queued' and kind = 'simulate'`);
    expect(jobs.rows).toHaveLength(1);
    await runJobs(env);
    const done = (await env.app.inject({ url: `/api/simulations/${r.json().id}`, headers: { cookie: a } })).json();
    expect(done.status).toBe('done');
    expect(done.result.illustrative).toBe(true); // < 30 trades → archetypes
    expect(done.result.scenarios.length).toBeGreaterThan(3);
    expect(done.result.ranking[0].sentence).toMatch(/→/);
  });

  it('refuses when the balance is zero (402) and does not enqueue', async () => {
    const n = await credits(a);
    for (let i = 0; i < n; i++) await env.app.inject({ method: 'POST', url: '/api/simulations', headers: { cookie: a }, payload: { accountId, runs: 100 } });
    expect(await credits(a)).toBe(0);
    const r = await env.app.inject({ method: 'POST', url: '/api/simulations', headers: { cookie: a }, payload: { accountId, runs: 100 } });
    expect(r.statusCode).toBe(402);
    await runJobs(env);
  });

  it('refunds automatically when the job finally fails (once)', async () => {
    const [run] = await env.ctx.db.select().from(simulationRuns).limit(1);
    // Grant a credit, start a run, then corrupt its config so the job throws on every attempt.
    await env.ctx.db.execute(sql`insert into credits_ledger (user_id, delta, reason, ref_id) values (${run!.userId}, 1, 'admin_grant', 'test-grant')`);
    const r = (await env.app.inject({ method: 'POST', url: '/api/simulations', headers: { cookie: a }, payload: { accountId, runs: 100 } })).json();
    await env.ctx.db.update(simulationRuns).set({ config: { broken: true } }).where(eq(simulationRuns.id, r.id));
    expect(await credits(a)).toBe(0);
    await env.ctx.db.execute(sql`update jobs set run_after = now() where status = 'queued'`);
    await runJobs(env);
    await env.ctx.db.execute(sql`update jobs set run_after = now() where status = 'queued'`);
    await runJobs(env);
    const failed = (await env.app.inject({ url: `/api/simulations/${r.id}`, headers: { cookie: a } })).json();
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/refunded/);
    expect(await credits(a)).toBe(1);
  });

  it("user B cannot see or start simulations on A's account", async () => {
    const list = (await env.app.inject({ url: `/api/simulations?accountId=${accountId}`, headers: { cookie: a } })).json();
    expect((await env.app.inject({ url: `/api/simulations/${list[0].id}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/simulations?accountId=${accountId}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'POST', url: '/api/simulations', headers: { cookie: b }, payload: { accountId } })).statusCode).toBe(404);
  });
});
