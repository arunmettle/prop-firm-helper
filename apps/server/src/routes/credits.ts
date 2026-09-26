import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import type { AppCtx } from '../ctx.js';
import { creditsLedger, users } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { balanceOf } from '../services/credits.js';

export function stripeClient(ctx: AppCtx): Stripe | null {
  const p = ctx.cfg.payments;
  if (!p.enabled) return null;
  if (!p.stripeSecretKey.startsWith('sk_test_')) {
    // MVP runs Stripe in test mode only.
    throw new HttpError(503, 'Payments are misconfigured (test-mode key required).');
  }
  return new Stripe(p.stripeSecretKey);
}

export async function creditRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };

  app.get('/api/credits', pre, async (req) => {
    const user = currentUser(req);
    const ledger = await ctx.db
      .select({
        id: creditsLedger.id,
        delta: creditsLedger.delta,
        reason: creditsLedger.reason,
        createdAt: creditsLedger.createdAt,
      })
      .from(creditsLedger)
      .where(eq(creditsLedger.userId, user.id))
      .orderBy(desc(creditsLedger.createdAt))
      .limit(100);
    return {
      balance: await balanceOf(ctx.db, user.id),
      ledger,
      paymentsEnabled: ctx.cfg.payments.enabled,
      packs: ctx.cfg.payments.enabled
        ? ctx.cfg.payments.packs.map((p) => ({
            id: p.id,
            credits: p.credits,
            label: p.label ?? `${p.credits} credits`,
          }))
        : [],
    };
  });

  app.post(
    '/api/credits/checkout',
    { ...pre, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const user = currentUser(req);
      const stripe = stripeClient(ctx);
      if (!stripe) throw new HttpError(404, 'Payments are not enabled.');
      const { packId } = parse(z.object({ packId: z.string().max(60) }), req.body);
      const pack = ctx.cfg.payments.packs.find((p) => p.id === packId);
      if (!pack) throw new HttpError(400, 'Unknown credit pack');
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: pack.priceId, quantity: 1 }],
        client_reference_id: user.id,
        metadata: { userId: user.id, packId: pack.id },
        success_url: `${ctx.cfg.appUrl}/credits?status=success`,
        cancel_url: `${ctx.cfg.appUrl}/credits?status=cancelled`,
      });
      return { url: session.url };
    },
  );

  // Webhook: raw body for signature verification, encapsulated so JSON parsing elsewhere is unaffected.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );
    scope.post('/api/stripe/webhook', async (req, reply) => {
      if (!ctx.cfg.payments.enabled) return reply.status(404).send({ error: 'Not found' });
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') return reply.status(400).send({ error: 'Missing signature' });
      let event: Stripe.Event;
      try {
        event = Stripe.webhooks.constructEvent(req.body as Buffer, sig, ctx.cfg.payments.webhookSecret);
      } catch {
        return reply.status(400).send({ error: 'Invalid signature' });
      }
      if (event.type === 'checkout.session.completed') {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== 'paid') return { received: true };
        const userId = s.metadata?.userId ?? s.client_reference_id;
        const pack = ctx.cfg.payments.packs.find((p) => p.id === s.metadata?.packId);
        if (!userId || !pack) return reply.status(400).send({ error: 'Unknown session' });
        const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (!u) return { received: true };
        // Idempotent: unique (reason, ref_id) — Stripe retries or replays can never double-credit.
        await ctx.db
          .insert(creditsLedger)
          .values({ userId, delta: pack.credits, reason: 'purchase', refId: s.id })
          .onConflictDoNothing();
      }
      return { received: true };
    });
  });
}
