import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let b: string;
let accountId: string;
beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'ta@example.com');
  b = await signIn(env, 'tb@example.com');
  accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
});
afterAll(async () => env.close());

const post = (cookie: string, payload: Record<string, unknown>) => env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie }, payload });

describe('trades', () => {
  it('computes risk, pnl and R on create', async () => {
    const r = await post(a, tradeBody(accountId));
    expect(r.statusCode).toBe(200);
    const t = r.json().trade;
    expect(t.riskAmount).toBe(1000);
    expect(t.pnl).toBe(2000);
    expect(t.rMultiple).toBe(2);
    expect(t.exitType).toBe('target');
  });

  it('stores an open trade without pnl or R', async () => {
    const r = await post(a, tradeBody(accountId, { closedAt: null, exitPrice: null, exitType: 'open' }));
    const t = r.json().trade;
    expect(t.pnl).toBeNull();
    expect(t.rMultiple).toBeNull();
    expect(t.riskAmount).toBe(1000);
  });

  it('records overrides', async () => {
    const r = await post(
      a,
      tradeBody(accountId, { exitPrice: 2395, exitType: 'manual_close', overrideFlag: true, overrideKind: 'closed_early', overrideNote: 'nervous' }),
    );
    const t = r.json().trade;
    expect(t.overrideKind).toBe('closed_early');
    expect(t.rMultiple).toBe(-0.5);
  });

  it('filters by outcome and override', async () => {
    const wins = await env.app.inject({ url: `/api/trades?accountId=${accountId}&outcome=win`, headers: { cookie: a } });
    expect(wins.json().trades.every((t: { pnl: number }) => t.pnl > 0)).toBe(true);
    const ov = await env.app.inject({ url: `/api/trades?accountId=${accountId}&override=yes`, headers: { cookie: a } });
    expect(ov.json().total).toBe(1);
    const open = await env.app.inject({ url: `/api/trades?accountId=${accountId}&outcome=open`, headers: { cookie: a } });
    expect(open.json().total).toBe(1);
  });

  it('updates recompute values and delete removes', async () => {
    const t = (await post(a, tradeBody(accountId))).json().trade;
    const u = await env.app.inject({
      method: 'PUT',
      url: `/api/trades/${t.id}`,
      headers: { cookie: a },
      payload: tradeBody(accountId, { exitPrice: 2390, exitType: 'stop', openedAt: t.openedAt, closedAt: t.closedAt }),
    });
    expect(u.json().trade.rMultiple).toBe(-1);
    const d = await env.app.inject({ method: 'DELETE', url: `/api/trades/${t.id}`, headers: { cookie: a } });
    expect(d.statusCode).toBe(200);
    expect((await env.app.inject({ url: `/api/trades/${t.id}`, headers: { cookie: a } })).statusCode).toBe(404);
  });

  it('returns setup tags for autocomplete', async () => {
    const r = await env.app.inject({ url: `/api/trades/setup-tags?accountId=${accountId}`, headers: { cookie: a } });
    expect(r.json()).toEqual(['breakout']);
  });

  it("user B cannot list, read, edit, delete or create trades on user A's account", async () => {
    const list = await env.app.inject({ url: `/api/trades?accountId=${accountId}`, headers: { cookie: a } });
    const tid = list.json().trades[0].id;
    expect((await env.app.inject({ url: `/api/trades?accountId=${accountId}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/trades/${tid}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect(
      (await env.app.inject({ method: 'PUT', url: `/api/trades/${tid}`, headers: { cookie: b }, payload: tradeBody(accountId) })).statusCode,
    ).toBe(404);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/trades/${tid}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await post(b, tradeBody(accountId))).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/trades/setup-tags', headers: { cookie: b } })).json()).toEqual([]);
  });

  it('account status reflects closed trades', async () => {
    const s = (await env.app.inject({ url: `/api/accounts/${accountId}/status`, headers: { cookie: a } })).json();
    expect(s.closedTrades).toBeGreaterThan(0);
    expect(s.openTrades).toBe(1);
    expect(s.evaluation.balance).toBe(100_000 + 2000 - 500);
  });
});
