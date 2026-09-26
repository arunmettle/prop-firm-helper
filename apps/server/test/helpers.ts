import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { MemoryEmailSender } from '../src/lib/email.js';
import type { AppCtx } from '../src/ctx.js';
import { createJevClient, FakeJevTransport, type JevClient } from '@cooldown/core/jev';
import { drain } from '../src/jobs/queue.js';
import { handlers } from '../src/jobs/handlers.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://cooldown:cooldown@localhost:5432/cooldown_test';

export interface TestEnv {
  ctx: AppCtx;
  app: FastifyInstance;
  email: MemoryEmailSender;
  close: () => Promise<void>;
}

export async function setupTestEnv(env: Record<string, string> = {}, jev?: JevClient): Promise<TestEnv> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_URL,
    APP_URL: 'http://localhost:5173',
    JEV_PROVIDER: 'fake',
    ADMIN_EMAILS: 'admin@example.com',
    SIGNUP_FREE_CREDITS: '3',
    ...env,
  });
  const { db, pool } = createDb(TEST_URL);
  await runMigrations(db);
  await db.execute(sql`truncate users, login_tokens, jobs cascade`);
  const email = new MemoryEmailSender();
  const ctx: AppCtx = {
    cfg,
    db,
    email,
    jev: jev ?? createJevClient(new FakeJevTransport(), { sleep: async () => {} }),
  };
  const app = await buildApp(ctx, { logger: true });
  return {
    ctx,
    app,
    email,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Sign in via the real magic-link flow; returns the session cookie header. */
export async function signIn(env: TestEnv, email: string): Promise<string> {
  const req = await env.app.inject({ method: 'POST', url: '/api/auth/request', payload: { email } });
  if (req.statusCode !== 200) throw new Error(`auth request failed ${req.statusCode} ${req.body}`);
  const msg = env.email.sent.filter((m) => m.to === email.toLowerCase()).at(-1);
  const token = new URL(/https?:\/\/\S+/.exec(msg!.text)![0]).searchParams.get('token')!;
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
  if (res.statusCode !== 200) throw new Error(`verify failed ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

/** Run all queued jobs (labelling, simulations) synchronously. */
export const runJobs = (env: TestEnv) => drain(env.ctx, handlers);
