import { JevError, type JevTransport } from './types.js';

/**
 * Direct TypeSafe API adapter — STUB. docs.typesafe.ai was unreachable from the build environment, so the endpoint,
 * auth header and envelope are unknown. Rather than guess, this throws a clear, non-retryable error.
 * Use JEV_PROVIDER=cloudflare (or fake) until this is implemented. See docs/DECISIONS.md.
 */
export class TypesafeJevTransport implements JevTransport {
  readonly provider = 'typesafe' as const;
  constructor(private apiKey: string) {}
  async call(): Promise<never> {
    throw new JevError(
      'The direct TypeSafe adapter is not implemented yet (API docs were unavailable at build time). Set JEV_PROVIDER=cloudflare or fake.',
      false,
    );
  }
}
