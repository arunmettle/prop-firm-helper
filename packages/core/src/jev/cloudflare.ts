import { JevError, type JevTransport, type Questions } from './types.js';

/**
 * Cloudflare Workers AI adapter for model `typesafe/jev`.
 * Endpoint follows the standard Workers AI REST shape:
 *   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/typesafe/jev
 *   → { success, result, errors, messages }
 * UNVERIFIED: the model page could not be fetched from the build environment (egress blocked). We accept the answers
 * either at `result.answers` or directly at `result`, and usage at `result.usage`. See docs/DECISIONS.md.
 */
export class CloudflareJevTransport implements JevTransport {
  readonly provider = 'cloudflare' as const;
  constructor(
    private accountId: string,
    private apiToken: string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 8000,
  ) {
    if (!accountId || !apiToken) throw new Error('Cloudflare Jev adapter needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }

  async call(state: unknown, questions: Questions) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/typesafe/jev`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, questions }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new JevError(`Cloudflare request failed: ${(e as Error).name}`, true);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new JevError(`Cloudflare HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { success?: boolean; result?: Record<string, unknown> };
    if (body.success === false || !body.result) throw new JevError('Cloudflare returned success=false', true);
    const result = body.result;
    const answers = (result.answers as unknown) ?? result;
    const usage = result.usage as { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | undefined;
    return {
      answers,
      usage: {
        input_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
      },
    };
  }
}
