import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs, setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let b: string;
let accountId: string;
beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'prof@example.com');
  b = await signIn(env, 'other@example.com');
  accountId = (
    await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: a },
      payload: accountBody(),
    })
  ).json().id;
  for (let i = 0; i < 12; i++) {
    await env.app.inject({
      method: 'POST',
      url: '/api/trades',
      headers: { cookie: a },
      payload: tradeBody(
        accountId,
        i % 3 === 0 ? { exitPrice: 2390, exitType: 'stop', preNote: 'Need to make back the last loss' } : {},
      ),
    });
  }
  await runJobs(env);
});
afterAll(async () => env.close());

describe('behaviour profile API', () => {
  it('returns metrics with sample sizes, conditional probs and the disclaimer', async () => {
    const r = await env.app.inject({ url: `/api/profile?accountId=${accountId}`, headers: { cookie: a } });
    expect(r.statusCode).toBe(200);
    const { profile, disclaimer } = r.json();
    expect(disclaimer).toMatch(/Not financial advice/);
    expect(profile.tradeCount).toBe(12);
    expect(profile.metrics.overall.n).toBe(12);
    expect(profile.conditionalProbs.buckets).toHaveLength(16);
    expect(profile.metrics.labels.byDriver.find((g: { key: string }) => g.key === 'revenge').n).toBe(4);
  });

  it('evidence endpoint only returns the caller’s trades', async () => {
    const list = (
      await env.app.inject({ url: `/api/trades?accountId=${accountId}`, headers: { cookie: a } })
    ).json();
    const ids = list.trades.map((t: { id: string }) => t.id);
    const mine = await env.app.inject({
      method: 'POST',
      url: '/api/trades/by-ids',
      headers: { cookie: a },
      payload: { ids },
    });
    expect(mine.json()).toHaveLength(12);
    const theirs = await env.app.inject({
      method: 'POST',
      url: '/api/trades/by-ids',
      headers: { cookie: b },
      payload: { ids },
    });
    expect(theirs.json()).toHaveLength(0);
    expect(
      (await env.app.inject({ url: `/api/profile?accountId=${accountId}`, headers: { cookie: b } }))
        .statusCode,
    ).toBe(404);
  });
});
