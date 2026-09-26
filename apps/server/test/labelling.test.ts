import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createJevClient, FakeJevTransport } from '@cooldown/core/jev';
import { runJobs, setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';

describe('note labelling (fake Jev)', () => {
  let env: TestEnv;
  let a: string;
  let accountId: string;
  beforeAll(async () => {
    env = await setupTestEnv();
    a = await signIn(env, 'label@example.com');
    accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
  });
  afterAll(async () => env.close());

  it('labels a trade in the background', async () => {
    const t = (await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: tradeBody(accountId) })).json().trade;
    expect(t.labelsStatus).toBe('pending');
    await runJobs(env);
    const after = (await env.app.inject({ url: `/api/trades/${t.id}`, headers: { cookie: a } })).json();
    expect(after.labelsStatus).toBe('done');
    expect(after.noteLabels.primary_driver.value).toBe('plan');
    expect(after.labelsVersion).toBe('note-v1+behaviour-v1');
  });

  it('asks override_justified only for overridden trades', async () => {
    const t = (
      await env.app.inject({
        method: 'POST',
        url: '/api/trades',
        headers: { cookie: a },
        payload: tradeBody(accountId, { overrideFlag: true, overrideKind: 'closed_early', overrideNote: 'closed before CPI news as per my rule', exitPrice: 2405, exitType: 'manual_close' }),
      })
    ).json().trade;
    await runJobs(env);
    const after = (await env.app.inject({ url: `/api/trades/${t.id}`, headers: { cookie: a } })).json();
    expect(after.noteLabels.override_justified.p).toBeGreaterThan(0.65);
  });

  it('trades without any note are not sent to Jev', async () => {
    const t = (
      await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: tradeBody(accountId, { preNote: null }) })
    ).json().trade;
    expect(t.labelsStatus).toBe('none');
  });

  it('tracks usage per user (no content)', async () => {
    const rows = await env.ctx.db.execute(sql`select calls, input_tokens from jev_usage`);
    const r = rows.rows[0] as { calls: number; input_tokens: number };
    expect(r.calls).toBeGreaterThanOrEqual(2);
    expect(r.input_tokens).toBeGreaterThan(0);
  });

  it('keepRawNotes=false removes note text after classification and keeps labels', async () => {
    const s = (await env.app.inject({ url: '/api/settings', headers: { cookie: a } })).json();
    await env.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie: a }, payload: { ...s, keepRawNotes: false } });
    const t = (
      await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: tradeBody(accountId, { preNote: 'Need to make back the last loss' }) })
    ).json().trade;
    await runJobs(env);
    const after = (await env.app.inject({ url: `/api/trades/${t.id}`, headers: { cookie: a } })).json();
    expect(after.preNote).toBeNull();
    expect(after.noteLabels.primary_driver.value).toBe('revenge');
    await env.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie: a }, payload: { ...s, keepRawNotes: true } });
  });
});

describe('note labelling failures', () => {
  let env: TestEnv;
  let a: string;
  let accountId: string;
  const transport = new FakeJevTransport({ failTimes: 1000 });
  beforeAll(async () => {
    env = await setupTestEnv({}, createJevClient(transport, { sleep: async () => {} }));
    a = await signIn(env, 'fail@example.com');
    accountId = (await env.app.inject({ method: 'POST', url: '/api/accounts', headers: { cookie: a }, payload: accountBody() })).json().id;
  });
  afterAll(async () => env.close());

  it('marks the trade failed after retries and never guesses a label', async () => {
    const t = (await env.app.inject({ method: 'POST', url: '/api/trades', headers: { cookie: a }, payload: tradeBody(accountId) })).json().trade;
    await runJobs(env);
    const after = (await env.app.inject({ url: `/api/trades/${t.id}`, headers: { cookie: a } })).json();
    expect(after.labelsStatus).toBe('failed');
    expect(after.noteLabels).toBeNull();
    expect(transport.calls).toBe(3);
  });

  it('re-label queues failed trades again', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/trades/relabel', headers: { cookie: a }, payload: { accountId } });
    expect(r.json().queued).toBe(1);
  });
});
