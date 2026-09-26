import { z } from 'zod';
import { JevError, type Answers, type Questions } from './types.js';

const prob = z.number().min(0).max(1);

function schemaFor(q: Questions[string]): z.ZodType {
  switch (q.type) {
    case 'noul':
      return z.object({ type: z.literal('noul').optional(), noul: prob });
    case 'choice': {
      const keys = Object.keys(q.criteria) as [string, ...string[]];
      return z.object({
        type: z.literal('choice').optional(),
        choice: z.enum(keys),
        confidence: prob,
        probabilities: z.record(z.string(), z.number()).optional(),
      });
    }
    case 'score':
      return z.object({
        type: z.literal('score').optional(),
        score: z
          .number()
          .int()
          .min(0)
          .max(q.criteria.length - 1),
        confidence: prob,
        legend: z.unknown().optional(),
        probabilities: z.unknown().optional(),
      });
  }
}

/** Validate a raw answer map against the question set. Throws a retryable JevError on any mismatch. */
export function validateAnswers<Q extends Questions>(questions: Q, raw: unknown): Answers<Q> {
  if (!raw || typeof raw !== 'object') throw new JevError('Jev response has no answers object', true);
  const out: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(questions)) {
    const r = schemaFor(q).safeParse((raw as Record<string, unknown>)[key]);
    if (!r.success) throw new JevError(`Jev answer "${key}" failed validation`, true);
    out[key] = { ...(r.data as object), type: q.type };
  }
  return out as Answers<Q>;
}

/** Low-confidence rule (§5): stored but shown as "uncertain" and excluded from headline stats. */
export function isUncertain(a: { type: string; noul?: number; confidence?: number }): boolean {
  if (a.type === 'noul') return a.noul! > 0.35 && a.noul! < 0.65;
  return (a.confidence ?? 0) < 0.6;
}
