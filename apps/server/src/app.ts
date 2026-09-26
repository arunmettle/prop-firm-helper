import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { AppCtx } from './ctx.js';
import { errorHandler } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes } from './routes/accounts.js';

export interface BuildOptions {
  logger?: boolean;
}

export async function buildApp(ctx: AppCtx, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          level: ctx.cfg.isProd ? 'info' : 'info',
          // Never log bodies, cookies or auth headers.
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        }
      : false,
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler(errorHandler);

  app.get('/api/health', async () => {
    await ctx.db.execute(sql`select 1`);
    return { ok: true };
  });

  await authRoutes(app, ctx);
  await accountRoutes(app, ctx);
  return app;
}
