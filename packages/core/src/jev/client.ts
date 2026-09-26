import { validateAnswers } from './validate.js';
import { JevError, type JevClient, type JevResult, type JevTransport, type Questions } from './types.js';

export interface RetryOptions {
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Wraps a transport with zod validation and retries (default: 2 retries with exponential backoff). */
export function createJevClient(transport: JevTransport, opts: RetryOptions = {}): JevClient {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? 300;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => performance.now());
  return {
    provider: transport.provider,
    async evaluate<Q extends Questions>(state: unknown, questions: Q): Promise<JevResult<Q>> {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
        const t0 = now();
        try {
          const raw = await transport.call(state, questions);
          const answers = validateAnswers(questions, raw.answers);
          return {
            answers,
            usage: {
              input_tokens: raw.usage?.input_tokens ?? 0,
              output_tokens: raw.usage?.output_tokens ?? 0,
            },
            latencyMs: Math.round(now() - t0),
            provider: transport.provider,
          };
        } catch (err) {
          lastErr = err;
          if (err instanceof JevError && !err.retryable) break;
        }
      }
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new JevError(`Jev failed after ${retries + 1} attempts: ${msg}`, false);
    },
  };
}
