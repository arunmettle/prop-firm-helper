import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let b: string;
beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'a@example.com');
  b = await signIn(env, 'b@example.com');
});
afterAll(async () => env.close());

describe('accounts', () => {
  it('creates, lists, updates and reports status', async () => {
    const c = await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() });
    expect(c.statusCode).toBe(200);
    const id = c.json().id;
    const list = await env.app.inject({ url: '/api/accounts', headers: { cookie: a } });
    expect(list.json()).toHaveLength(1);
    const u = await env.app.inject({
      method: 'PUT',
      url: `/api/accounts/${id}`,
      headers: { cookie: a },
      payload: accountBody({ label: 'Renamed' }),
    });
    expect(u.json().label).toBe('Renamed');
    const s = await env.app.inject({ url: `/api/accounts/${id}/status`, headers: { cookie: a } });
    expect(s.statusCode).toBe(200);
    expect(s.json().evaluation.dailyLossRemaining).toBe(5000);
  });

  it('rejects invalid rules with field paths but no values', async () => {
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: a },
      payload: accountBody({ rules: { ...accountBody().rules, dayResetTimezone: 'Nowhere/Land' } }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().details[0].path).toBe('rules.dayResetTimezone');
  });

  it("user B cannot read, update or delete user A's account", async () => {
    const list = await env.app.inject({ url: '/api/accounts', headers: { cookie: a } });
    const id = list.json()[0].id;
    expect((await env.app.inject({ url: `/api/accounts/${id}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/accounts/${id}/status`, headers: { cookie: b } })).statusCode).toBe(404);
    expect(
      (await env.app.inject({ method: 'PUT', url: `/api/accounts/${id}`, headers: { cookie: b }, payload: accountBody() })).statusCode,
    ).toBe(404);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/accounts/${id}`, headers: { cookie: b } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/accounts', headers: { cookie: b } })).json()).toHaveLength(0);
  });
});
