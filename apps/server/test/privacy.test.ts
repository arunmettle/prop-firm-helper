import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runJobs, setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let b: string;
let aAcc: string;
let bAcc: string;
beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'priv-a@example.com');
  b = await signIn(env, 'priv-b@example.com');
  aAcc = (
    await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: a },
      payload: accountBody(),
    })
  ).json().id;
  bAcc = (
    await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: b },
      payload: accountBody(),
    })
  ).json().id;
  for (const [c, acc] of [
    [a, aAcc],
    [b, bAcc],
  ] as const) {
    for (let i = 0; i < 3; i++)
      await env.app.inject({
        method: 'POST',
        url: '/api/trades',
        headers: { cookie: c },
        payload: tradeBody(acc, { preNote: '=cmd|evil note' }),
      });
    await env.app.inject({
      method: 'POST',
      url: '/api/prechecks',
      headers: { cookie: c },
      payload: {
        accountId: acc,
        direction: 'long',
        entry: 2400,
        stop: 2390,
        riskPct: 1,
        preNote: 'plan retest',
      },
    });
    await env.app.inject({
      method: 'POST',
      url: '/api/simulations',
      headers: { cookie: c },
      payload: { accountId: acc, runs: 100 },
    });
  }
  await runJobs(env);
});
afterAll(async () => env.close());

describe('export', () => {
  it('JSON export contains only my data', async () => {
    const r = await env.app.inject({ url: '/api/export.json', headers: { cookie: a } });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.user.email).toBe('priv-a@example.com');
    expect(d.trades).toHaveLength(3);
    expect(d.trades.every((t: { accountId: string }) => t.accountId === aAcc)).toBe(true);
    expect(d.prechecks).toHaveLength(1);
    expect(d.simulations).toHaveLength(1);
    expect(d.accounts).toHaveLength(1);
  });
  it('CSV export has a header, my rows, and neutralises formulas', async () => {
    const r = await env.app.inject({ url: '/api/export/trades.csv', headers: { cookie: a } });
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toMatch(/^id,accountId,instrument/);
    expect(lines).toHaveLength(4);
    expect(r.body).toContain("'=cmd|evil note");
  });
});

describe('hard delete', () => {
  it('requires explicit confirmation', async () => {
    expect(
      (await env.app.inject({ method: 'POST', url: '/api/me/delete', headers: { cookie: a }, payload: {} }))
        .statusCode,
    ).toBe(400);
  });
  it('removes every row for the user in one go and leaves other users untouched', async () => {
    const rows = (await env.ctx.db.execute(sql`select id from users where email = 'priv-a@example.com'`))
      .rows as { id: string }[];
    const id = rows[0]!.id;
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/me/delete',
      headers: { cookie: a },
      payload: { confirm: 'DELETE' },
    });
    expect(r.statusCode).toBe(200);
    for (const table of [
      'accounts',
      'trades',
      'prechecks',
      'simulation_runs',
      'credits_ledger',
      'sessions',
      'behaviour_profiles',
      'jev_usage',
    ]) {
      const c = await env.ctx.db.execute(
        sql.raw(`select count(*)::int as n from ${table} where user_id = '${id}'`),
      );
      expect((c.rows[0] as { n: number }).n, table).toBe(0);
    }
    const u = await env.ctx.db.execute(sql`select count(*)::int as n from users where id = ${id}`);
    expect((u.rows[0] as { n: number }).n).toBe(0);
    const j = await env.ctx.db.execute(
      sql`select count(*)::int as n from jobs where payload->>'userId' = ${id}`,
    );
    expect((j.rows[0] as { n: number }).n).toBe(0);
    const t = await env.ctx.db.execute(
      sql`select count(*)::int as n from login_tokens where email = 'priv-a@example.com'`,
    );
    expect((t.rows[0] as { n: number }).n).toBe(0);
    expect((await env.app.inject({ url: '/api/me', headers: { cookie: a } })).statusCode).toBe(401);
    const bTrades = await env.app.inject({ url: `/api/trades?accountId=${bAcc}`, headers: { cookie: b } });
    expect(bTrades.json().total).toBe(3);
  });
});

describe('admin', () => {
  it('is invisible (404) to non-admins and shows counters only to admins', async () => {
    expect((await env.app.inject({ url: '/api/admin/usage', headers: { cookie: b } })).statusCode).toBe(404);
    const admin = await signIn(env, 'admin@example.com');
    const r = await env.app.inject({ url: '/api/admin/usage', headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toMatch(/note|retest/i);
  });
});
