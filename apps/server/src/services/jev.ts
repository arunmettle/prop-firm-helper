import { sql } from 'drizzle-orm';
import {
  CloudflareJevTransport,
  createJevClient,
  FakeJevTransport,
  TypesafeJevTransport,
  type JevClient,
  type JevResult,
  type Questions,
} from '@cooldown/core/jev';
import type { Config } from '../config.js';
import type { AppCtx } from '../ctx.js';
import { jevUsage } from '../db/schema.js';

export function createJevFromConfig(cfg: Config): JevClient {
  switch (cfg.jev.provider) {
    case 'cloudflare':
      return createJevClient(
        new CloudflareJevTransport(cfg.jev.cloudflareAccountId, cfg.jev.cloudflareApiToken),
      );
    case 'typesafe':
      return createJevClient(new TypesafeJevTransport(cfg.jev.typesafeApiKey));
    default:
      return createJevClient(new FakeJevTransport(), { backoffMs: 1 });
  }
}

/**
 * The only way server code calls Jev. Logs question keys, latency and token usage — NEVER the state
 * (it contains the trader's notes). Tracks per-user usage for the admin cost view.
 */
export async function callJev<Q extends Questions>(
  ctx: AppCtx,
  userId: string,
  purpose: string,
  state: unknown,
  questions: Q,
): Promise<JevResult<Q>> {
  const keys = Object.keys(questions).join(',');
  const day = new Date().toISOString().slice(0, 10);
  try {
    const r = await ctx.jev.evaluate(state, questions);
    console.info(
      `[jev] purpose=${purpose} provider=${r.provider} keys=${keys} latency_ms=${r.latencyMs} input_tokens=${r.usage.input_tokens} output_tokens=${r.usage.output_tokens}`,
    );
    await ctx.db
      .insert(jevUsage)
      .values({
        userId,
        day,
        calls: 1,
        inputTokens: r.usage.input_tokens,
        outputTokens: r.usage.output_tokens,
      })
      .onConflictDoUpdate({
        target: [jevUsage.userId, jevUsage.day],
        set: {
          calls: sql`${jevUsage.calls} + 1`,
          inputTokens: sql`${jevUsage.inputTokens} + ${r.usage.input_tokens}`,
          outputTokens: sql`${jevUsage.outputTokens} + ${r.usage.output_tokens}`,
          updatedAt: new Date(),
        },
      });
    return r;
  } catch (err) {
    console.warn(
      `[jev] purpose=${purpose} provider=${ctx.jev.provider} keys=${keys} status=failed error=${(err as Error).name}`,
    );
    await ctx.db
      .insert(jevUsage)
      .values({ userId, day, failures: 1 })
      .onConflictDoUpdate({
        target: [jevUsage.userId, jevUsage.day],
        set: { failures: sql`${jevUsage.failures} + 1`, updatedAt: new Date() },
      });
    throw err;
  }
}
