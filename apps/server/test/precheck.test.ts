import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJevClient, FakeJevTransport } from '@cooldown/core/jev';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

const body = (accountId: string, o: Record<string, unknown> = {}) => ({
  accountId,
  instrument: 'XAUUSD',
  direction: 'long',
  entry: 2400,
  stop: 2390,
  target: 2420,
  setupTag: 'breakout',
  riskPct: 1,
  preNote: 'London breakout retest with clean structure',
  ...o,
});

describe('pre-trade check', () => {
  let env: TestEnv;
  let a: string;
  let b: string;
  let accountId: string;
  beforeAll(async () => {
    env = await setupTestEnv();
    a = await signIn(env, 'pc@example.com');
    b = await signIn(env, 'pc2@example.com');
    accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
  });
  afterAll(async () => env.close());

  it('returns size, R:R, budgets and a verdict with reasons', async () => {
    const t0 = Date.now();
    const r = await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: a }, payload: body(accountId) });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.computed.positionSizeLots).toBe(1);
    expect(p.computed.sizing.rewardRisk).toBe(2);
    expect(p.computed.dailyLossRemainingAfter).toBe(4000);
    expect(p.verdict).toBe('go');
    expect(p.jev.status).toBe('ok');
    expect(p.reasons.length).toBeGreaterThan(0);
  });

  it('stops when risk exceeds the remaining daily budget', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: a }, payload: body(accountId, { riskPct: 6 }) });
    expect(r.json().verdict).toBe('stop');
    expect(r.json().reasons.map((x: { code: string }) => x.code)).toContain('daily_budget');
  });

  it('requires a pre-note', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: a }, payload: body(accountId, { preNote: '' }) });
    expect(r.statusCode).toBe(400);
  });

  it('logging a trade from a check links them', async () => {
    const p = (await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: a }, payload: body(accountId) })).json();
    const t = (
      await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: { ...tradeBody(accountId), precheckId: p.id } })
    ).json().trade;
    const again = (await env.app.inject({ url: `/api/prechecks/${p.id}`, headers: { cookie: a } })).json();
    expect(again.linkedTradeId).toBe(t.id);
  });

  it("user B cannot read A's checks or run one on A's account", async () => {
    const list = (await env.app.inject({ url: `/api/prechecks?accountId=${accountId}`, headers: { cookie: a } })).json();
    expect(list.length).toBeGreaterThan(0);
    expect((await env.app.inject({ url: `/api/prechecks/${list[0].id}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/prechecks?accountId=${accountId}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: b }, payload: body(accountId) })).statusCode).toBe(404);
    // B linking A's check to B's trade must not work either
    const before = (await env.app.inject({ url: `/api/prechecks/${list[0].id}`, headers: { cookie: a } })).json().linkedTradeId;
    const bAcc = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: b }, payload: accountBody() })).json().id;
    await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: b }, payload: { ...tradeBody(bAcc), precheckId: list[0].id } });
    const still = (await env.app.inject({ url: `/api/prechecks/${list[0].id}`, headers: { cookie: a } })).json();
    expect(still.linkedTradeId).toBe(before);
  });
});

describe('pre-trade check when Jev is down', () => {
  let env: TestEnv;
  let a: string;
  let accountId: string;
  beforeAll(async () => {
    env = await setupTestEnv({}, createJevClient(new FakeJevTransport({ failTimes: 99 }), { sleep: async () => {} }));
    a = await signIn(env, 'down@example.com');
    accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
  });
  afterAll(async () => env.close());

  it('still returns a rules-only verdict and says so', async () => {
    const r = (await env.app.inject({ method: 'POST', url: '/api/prechecks', headers: { cookie: a }, payload: body(accountId) })).json();
    expect(r.jev.status).toBe('failed');
    expect(r.verdict).toBe('go');
    expect(r.reasons.map((x: { code: string }) => x.code)).toContain('jev_failed');
  });
});
