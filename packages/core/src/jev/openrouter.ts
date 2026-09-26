import { JevError, type JevTransport, type Questions } from './types.js';

export const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
/** Pinned version so labels stay comparable over time. `typesafe/jev-latest` follows new releases. */
export const OPENROUTER_DEFAULT_JEV_MODEL = 'typesafe/jev-1.13';

/**
 * Jev via OpenRouter's Decisions API (NOT chat completions — chat SDKs don't work with Jev).
 *   POST https://openrouter.ai/api/alpha/decisions
 *   { model, state, questions } → { answers, usage: { input_tokens, output_tokens, cost }, provider, model }
 * Errors come back as HTTP errors and/or an `error` object in the body.
 */
export class OpenRouterJevTransport implements JevTransport {
  readonly provider = 'openrouter' as const;
  constructor(
    private apiKey: string,
    private model: string = OPENROUTER_DEFAULT_JEV_MODEL,
    private opts: { fetchImpl?: typeof fetch; timeoutMs?: number; appUrl?: string; appName?: string } = {},
  ) {
    if (!apiKey) throw new Error('OpenRouter Jev adapter needs OPENROUTER_API_KEY');
  }

  async call(state: unknown, questions: Questions) {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    // Optional OpenRouter app attribution headers.
    if (this.opts.appUrl) headers['HTTP-Referer'] = this.opts.appUrl;
    if (this.opts.appName) headers['X-Title'] = this.opts.appName;
    let res: Response;
    try {
      res = await fetchImpl(OPENROUTER_DECISIONS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, state, questions }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new JevError(`OpenRouter request failed: ${(e as Error).name}`, true);
    } finally {
      clearTimeout(timer);
    }
    type Body = {
      answers?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
      error?: { code?: number | string; message?: string };
    };
    let body: Body | null = null;
    try {
      body = (await res.json()) as Body;
    } catch {
      body = null;
    }
    if (!res.ok || body?.error) {
      const status = typeof body?.error?.code === 'number' ? body.error.code : res.status;
      // 401/402/403: bad key, no credit, or model not allowed — retrying won't help.
      const retryable = status === 429 || status >= 500 || status === 408;
      throw new JevError(`OpenRouter error ${status}`, retryable);
    }
    if (!body?.answers) throw new JevError('OpenRouter response has no answers', true);
    return {
      answers: body.answers,
      usage: {
        input_tokens: body.usage?.input_tokens ?? 0,
        output_tokens: body.usage?.output_tokens ?? 0,
        cost: body.usage?.cost ?? 0,
      },
    };
  }
}
