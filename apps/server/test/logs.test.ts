import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJevClient, FakeJevTransport } from '@cooldown/core/jev';
import { runJobs, setupTestEnv, signIn, type TestEnv } from './helpers.js';
import { accountBody, tradeBody } from './fixtures.js';
import { captured } from './logCapture.js';

/** A note string that must never appear in any log output. */
const SENTINEL = 'SENTINEL-7f3a9c-my-private-note';

async function exercise(env: TestEnv) {
  const cookie = await signIn(env, `log${Math.random().toString(36).slice(2)}@example.com`);
  const accountId = (
    await env.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie },
      payload: accountBody(),
    })
  ).json().id;
  const t = await env.app.inject({
    method: 'POST',
    url: '/api/trades',
    headers: { cookie },
    payload: tradeBody(accountId, {
      preNote: SENTINEL,
      overrideFlag: true,
      overrideKind: 'moved_stop',
      overrideNote: SENTINEL,
    }),
  });
  // Validation error with the sentinel in the body
  await env.app.inject({
    method: 'POST',
    url: '/api/trades',
    headers: { cookie },
    payload: { ...tradeBody(accountId, { preNote: SENTINEL }), stopPrice: 99999 },
  });
  await env.app.inject({
    method: 'POST',
    url: '/api/trades',
    headers: { cookie },
    payload: { garbage: SENTINEL },
  });
  await env.app.inject({
    method: 'POST',
    url: '/api/prechecks',
    headers: { cookie },
    payload: { accountId, direction: 'long', entry: 2400, stop: 2390, riskPct: 1, preNote: SENTINEL },
  });
  await env.app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { cookie },
    payload: {
      accountId,
      rows: [
        {
          instrument: 'XAUUSD',
          direction: 'long',
          sizeLots: 1,
          entryPrice: 2400,
          stopPrice: 2390,
          targetPrice: null,
          openedAt: '2026-07-01T10:00:00Z',
          closedAt: null,
          exitPrice: null,
          pnl: null,
          exitType: 'open',
          setupTag: null,
          preNote: SENTINEL,
        },
      ],
    },
  });
  await env.app.inject({
    method: 'PUT',
    url: `/api/trades/${t.json().trade.id}`,
    headers: { cookie },
    payload: { broken: SENTINEL },
  });
  // Malformed JSON body containing the sentinel
  await env.app.inject({
    method: 'POST',
    url: '/api/trades',
    headers: { cookie, 'content-type': 'application/json' },
    payload: `{"preNote": "${SENTINEL}"`,
  });
  await runJobs(env);
}

describe('note text never reaches logs', () => {
  let ok: TestEnv;
  let failing: TestEnv;
  beforeAll(async () => {
    ok = await setupTestEnv();
    failing = await setupTestEnv(
      {},
      createJevClient(new FakeJevTransport({ failTimes: 999 }), { sleep: async () => {} }),
    );
  });
  afterAll(async () => {
    await ok.close();
    await failing.close();
  });

  it('with a working and a failing Jev provider', async () => {
    await exercise(ok);
    await exercise(failing);
    const all = captured.join('');
    expect(all.length).toBeGreaterThan(1000); // logging really was on
    expect(all).toContain('[jev]');
    expect(all).not.toContain(SENTINEL);
  });
});
