import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setupTestEnv, signIn, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe('health + auth', () => {
  it('health check', async () => {
    const r = await env.app.inject({ url: '/api/health' });
    expect(r.json()).toEqual({ ok: true });
  });

  it('rejects unauthenticated /api/me', async () => {
    const r = await env.app.inject({ url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });

  it('magic link signs in, stores only hashed tokens, grants signup credits', async () => {
    const cookie = await signIn(env, 'Trader@Example.com');
    const me = await env.app.inject({ url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('trader@example.com');
    expect(me.json().credits).toBe(3);
    const raw = cookie.split('=')[1]!;
    const rows = await env.ctx.db.execute(sql`select token_hash from sessions`);
    expect(rows.rows.every((r) => (r as { token_hash: string }).token_hash !== raw)).toBe(true);
    expect((rows.rows[0] as { token_hash: string }).token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a magic link can be used only once', async () => {
    await env.app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'once@example.com' } });
    const token = new URL(/https?:\/\/\S+/.exec(env.email.sent.at(-1)!.text)![0]).searchParams.get('token')!;
    const a = await env.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    const b = await env.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(400);
  });

  it('session cookie is httpOnly and SameSite=Lax', async () => {
    await env.app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'cookie@example.com' } });
    const token = new URL(/https?:\/\/\S+/.exec(env.email.sent.at(-1)!.text)![0]).searchParams.get('token')!;
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    const c = String(r.headers['set-cookie']);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
  });

  it('logout invalidates the session', async () => {
    const cookie = await signIn(env, 'bye@example.com');
    await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const me = await env.app.inject({ url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('rate limits magic-link requests', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await env.app.inject({
        method: 'POST',
        url: '/api/auth/request',
        payload: { email: `rl${i}@example.com` },
        remoteAddress: '10.9.9.9',
      });
      codes.push(r.statusCode);
    }
    expect(codes).toContain(429);
  });
});
