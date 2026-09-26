import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody } from './fixtures.js';

let env: TestEnv;
let a: string;
let accountId: string;
beforeAll(async () => {
  env = await setupTestEnv();
  a = await signIn(env, 'imp@example.com');
  accountId = (
    await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: a },
      payload: accountBody(),
    })
  ).json().id;
});
afterAll(async () => env.close());

const row = (i: number, o: Record<string, unknown> = {}) => ({
  instrument: 'XAUUSD',
  direction: 'long',
  sizeLots: 1,
  entryPrice: 2400 + i,
  stopPrice: 2390 + i,
  targetPrice: null,
  openedAt: `2026-07-0${1 + (i % 5)}T10:00:00.000Z`,
  closedAt: `2026-07-0${1 + (i % 5)}T11:00:00.000Z`,
  exitPrice: 2405 + i,
  pnl: 500,
  exitType: 'manual_close',
  setupTag: null,
  preNote: null,
  ...o,
});

describe('csv import', () => {
  it('imports rows and is idempotent', async () => {
    const payload = { accountId, rows: [row(0), row(1), row(2)], mapping: { openedAt: 'Open Time' } };
    const first = await env.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: a },
      payload,
    });
    expect(first.json()).toMatchObject({ inserted: 3, duplicates: 0 });
    const second = await env.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: a },
      payload,
    });
    expect(second.json()).toMatchObject({ inserted: 0, duplicates: 3 });
    const list = await env.app.inject({ url: `/api/trades?accountId=${accountId}`, headers: { cookie: a } });
    expect(list.json().total).toBe(3);
    expect(list.json().trades[0].source).toBe('csv');
  });

  it('dedupes within one file', async () => {
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: a },
      payload: { accountId, rows: [row(3), row(3)] },
    });
    expect(r.json()).toMatchObject({ inserted: 1, duplicates: 1 });
  });

  it('saves the column mapping to settings', async () => {
    const me = await env.app.inject({ url: '/api/me', headers: { cookie: a } });
    expect(me.json().settings.csvMapping).toEqual({ openedAt: 'Open Time' });
  });

  it('rejects any non-whitelisted column', async () => {
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: a },
      payload: { accountId, rows: [{ ...row(4), accountNumber: '51234567' }] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('reports invalid rows without failing the batch', async () => {
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { cookie: a },
      payload: { accountId, rows: [row(10), row(11, { stopPrice: 9999 })] },
    });
    expect(r.json().inserted).toBe(1);
    expect(r.json().errors[0]).toMatchObject({ row: 2 });
  });
});
