/** Jev (TypeSafe "System One") question + answer types. Answers are inferred from question definitions. */

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}
export interface ChoiceQuestion<K extends string = string> {
  type: 'choice';
  instructions: string;
  criteria: Record<K, string>;
}
export interface ScoreQuestion<L extends readonly string[] = readonly string[]> {
  type: 'score';
  instructions: string;
  criteria: L;
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export interface ChoiceAnswer<K extends string = string> {
  type: 'choice';
  choice: K;
  confidence: number;
  probabilities?: Partial<Record<K, number>>;
}
export interface ScoreAnswer<L extends string = string> {
  type: 'score';
  /** Position on the rubric: 0..n-1. May be FRACTIONAL (a probability-weighted mean) — use `scoreLevel()`. */
  score: number;
  confidence: number;
  legend?: L | unknown;
  probabilities?: unknown;
}

export type AnswerFor<Q> = Q extends { type: 'noul' }
  ? NoulAnswer
  : Q extends { type: 'choice'; criteria: infer C }
    ? ChoiceAnswer<Extract<keyof C, string>>
    : Q extends { type: 'score'; criteria: infer L extends readonly string[] }
      ? ScoreAnswer<L[number]>
      : never;

export type Answers<Q extends Questions> = { [K in keyof Q]: AnswerFor<Q[K]> };

export type JevProvider = 'openrouter' | 'cloudflare' | 'typesafe' | 'fake';

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  /** Provider-reported cost in USD, when available (OpenRouter). */
  cost?: number;
}

export interface JevResult<Q extends Questions> {
  answers: Answers<Q>;
  usage: JevUsage;
  latencyMs: number;
  provider: string;
}

export interface JevClient {
  readonly provider: JevProvider;
  evaluate<Q extends Questions>(state: unknown, questions: Q): Promise<JevResult<Q>>;
}

/** Raw adapter: returns the unvalidated answer map + usage. Validation and retries are layered on top. */
export interface JevTransport {
  readonly provider: JevProvider;
  call(state: unknown, questions: Questions): Promise<{ answers: unknown; usage?: Partial<JevUsage> }>;
}

export class JevError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

/** Identity helper that preserves literal types for answer inference. */
export const defineQuestions = <const Q extends Questions>(q: Q): Q => q;
