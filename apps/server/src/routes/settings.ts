import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parseUserSettings, userSettingsSchema } from '@cooldown/core';
import type { AppCtx } from '../ctx.js';
import { users } from '../db/schema.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { parse } from '../lib/http.js';

export async function settingsRoutes(app: FastifyInstance, ctx: AppCtx) {
  const pre = { preHandler: requireUser(ctx) };
  app.get('/api/settings', pre, async (req) => parseUserSettings(currentUser(req).settings));
  app.put('/api/settings', pre, async (req) => {
    const user = currentUser(req);
    const next = parse(userSettingsSchema, req.body);
    await ctx.db.update(users).set({ settings: next }).where(eq(users.id, user.id));
    return next;
  });
}
