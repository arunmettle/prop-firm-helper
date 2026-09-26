import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../ctx.js';
import { loginTokens, sessions, users } from '../db/schema.js';
import {
  createSession,
  isAdmin,
  requireUser,
  currentUser,
  SESSION_COOKIE,
  setSessionCookie,
} from '../lib/auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, parse } from '../lib/http.js';
import { parseUserSettings } from '@cooldown/core';
import { grantSignupCredits, balanceOf } from '../services/credits.js';

const LINK_MINUTES = 15;

export async function authRoutes(app: FastifyInstance, ctx: AppCtx) {
  const authLimit = { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } };

  app.post('/api/auth/request', authLimit, async (req) => {
    const { email } = parse(z.object({ email: z.email().max(254) }), req.body);
    const normalized = email.trim().toLowerCase();
    const token = randomToken(32);
    await ctx.db.insert(loginTokens).values({
      email: normalized,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000),
    });
    const link = `${ctx.cfg.appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    await ctx.email.send({
      to: normalized,
      subject: 'Your Cooldown sign-in link',
      text: `Sign in to Cooldown: ${link}\n\nThis link expires in ${LINK_MINUTES} minutes. If you didn't request it, ignore this email.`,
      html: `<p><a href="${link}">Sign in to Cooldown</a></p><p>This link expires in ${LINK_MINUTES} minutes. If you didn't request it, ignore this email.</p>`,
    });
    // Dev convenience: when emails only go to the console, hand the link back so local sign-in is one click.
    const devLink = !ctx.cfg.isProd && ctx.email.kind !== 'resend' ? link : undefined;
    return { ok: true, devLink };
  });

  app.post('/api/auth/verify', authLimit, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const user = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(loginTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(loginTokens.tokenHash, sha256(token)),
            isNull(loginTokens.usedAt),
            gt(loginTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!row) throw new HttpError(400, 'This sign-in link is invalid or has expired. Request a new one.');
      const [existing] = await tx.select().from(users).where(eq(users.email, row.email)).limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(users)
        .values({ email: row.email, settings: parseUserSettings({}) })
        .returning();
      if (!created) throw new Error('user insert failed');
      await grantSignupCredits(tx, created.id, ctx.cfg.signupFreeCredits);
      return created;
    });
    const sessionToken = await createSession(ctx, user.id);
    setSessionCookie(ctx, reply, sessionToken);
    return { user: { id: user.id, email: user.email } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await ctx.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser(ctx) }, async (req) => {
    const user = currentUser(req);
    return {
      id: user.id,
      email: user.email,
      settings: parseUserSettings(user.settings),
      isAdmin: isAdmin(ctx, user),
      credits: await balanceOf(ctx.db, user.id),
      paymentsEnabled: ctx.cfg.payments.enabled,
    };
  });
}
