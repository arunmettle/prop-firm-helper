import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppCtx } from '../ctx.js';
import { sessions, users, type User } from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'cd_session';
export const SESSION_DAYS = 30;

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export async function createSession(ctx: AppCtx, userId: string): Promise<string> {
  const token = randomToken(32);
  await ctx.db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  return token;
}

export function setSessionCookie(ctx: AppCtx, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.cfg.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function userFromRequest(ctx: AppCtx, req: FastifyRequest): Promise<User | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await ctx.db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

/** preHandler: 401 unless signed in. Sets req.user. */
export const requireUser = (ctx: AppCtx) => async (req: FastifyRequest) => {
  const user = await userFromRequest(ctx, req);
  if (!user) throw new HttpError(401, 'Please sign in.');
  req.user = user;
};

export const currentUser = (req: FastifyRequest): User => {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
};

export const isAdmin = (ctx: AppCtx, user: User) => ctx.cfg.adminEmails.includes(user.email.toLowerCase());
