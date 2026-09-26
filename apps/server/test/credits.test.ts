import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema.js';
import { grantCredits } from '../src/services/credits.js';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';

const SECRET = 'whsec_test_secret';
const PACKS = JSON.stringify([{ id: 'pack10', credits: 10, priceId: 'price_test_123' }]);

function signed(payload: object) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { body, header };
}
const completed = (id: string, userId: string, packId = 'pack10', paid = 'paid') => ({
  id: `evt_${id}`,
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id,
      object: 'checkout.session',
      payment_status: paid,
      client_reference_id: userId,
      metadata: { userId, packId },
    },
  },
});

describe('credits + payments enabled', () => {
  let env: TestEnv;
  let cookie: string;
  let userId: string;
  beforeAll(async () => {
    env = await setupTestEnv({
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: SECRET,
      STRIPE_CREDIT_PACKS: PACKS,
    });
    cookie = await signIn(env, 'buyer@example.com');
    userId = (await env.ctx.db.select().from(users).where(eq(users.email, 'buyer@example.com')))[0]!.id;
  });
  afterAll(async () => env.close());

  const credits = async () =>
    (await env.app.inject({ url: '/api/credits', headers: { cookie } })).json().balance;
  const post = (p: { body: string; header: string }) =>
    env.app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: { 'stripe-signature': p.header, 'content-type': 'application/json' },
      payload: p.body,
    });

  it('lists packs and the ledger', async () => {
    const r = (await env.app.inject({ url: '/api/credits', headers: { cookie } })).json();
    expect(r.paymentsEnabled).toBe(true);
    expect(r.packs[0]).toMatchObject({ id: 'pack10', credits: 10 });
    expect(r.ledger).toHaveLength(1);
  });

  it('a verified webhook grants credits exactly once (idempotent)', async () => {
    const before = await credits();
    const p = signed(completed('cs_test_1', userId));
    expect((await post(p)).statusCode).toBe(200);
    expect((await post(p)).statusCode).toBe(200);
    expect((await post(signed(completed('cs_test_1', userId)))).statusCode).toBe(200);
    expect(await credits()).toBe(before + 10);
  });

  it('rejects an invalid signature', async () => {
    const before = await credits();
    const body = JSON.stringify(completed('cs_test_2', userId));
    const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_wrong' });
    const r = await post({ body, header });
    expect(r.statusCode).toBe(400);
    expect(await credits()).toBe(before);
  });

  it('ignores unpaid sessions', async () => {
    const before = await credits();
    await post(signed(completed('cs_test_3', userId, 'pack10', 'unpaid')));
    expect(await credits()).toBe(before);
  });

  it('admin grant adds to the ledger', async () => {
    const before = await credits();
    await grantCredits(env.ctx.db, userId, 5, 'cli:test');
    expect(await credits()).toBe(before + 5);
    await expect(grantCredits(env.ctx.db, userId, 0, 'cli:zero')).rejects.toThrow();
  });
});

describe('payments disabled (default)', () => {
  let env: TestEnv;
  let cookie: string;
  beforeAll(async () => {
    env = await setupTestEnv();
    cookie = await signIn(env, 'free@example.com');
  });
  afterAll(async () => env.close());

  it('hides packs and refuses checkout and webhooks', async () => {
    expect((await env.app.inject({ url: '/api/credits', headers: { cookie } })).json().packs).toEqual([]);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/credits/checkout',
          headers: { cookie },
          payload: { packId: 'pack10' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await env.app.inject({
          method: 'POST',
          url: '/api/stripe/webhook',
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
      ).statusCode,
    ).toBe(404);
  });
});
