import { describe, expect, it } from 'vitest';
import {
  createJevClient,
  LABEL_QUESTIONS,
  NOTE_CLASSIFIER_V1,
  OpenRouterJevTransport,
  PRECHECK_V1,
  scoreLevel,
  toNoteLabels,
} from '../src/jev/index.js';

const noSleep = { sleep: async () => {} };

/** Shaped like the documented OpenRouter Decisions response. */
const okBody = {
  answers: {
    tilt_risk: {
      type: 'score',
      score: 1.62,
      confidence: 0.81,
      legend: { '0': 'Low', '1': 'Elevated', '2': 'High' },
      probabilities: { '0': 0.05, '1': 0.28, '2': 0.67 },
    },
    matches_stated_setup: { type: 'noul', noul: 0.12 },
    likely_impulse: { type: 'noul', noul: 0.91 },
  },
  usage: { input_tokens: 423, output_tokens: 70, cost: 0.000018 },
  provider: 'TypeSafe',
  model: 'typesafe/jev-1.13',
};

function mockFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('OpenRouter Jev adapter', () => {
  it('posts {model, state, questions} to the Decisions API with a bearer key', async () => {
    const m = mockFetch([{ status: 200, body: okBody }]);
    const t = new OpenRouterJevTransport('sk-or-test', 'typesafe/jev-1.13', {
      fetchImpl: m.impl,
      appName: 'Cooldown',
    });
    const r = await createJevClient(t, noSleep).evaluate({ pre_note: 'x' }, PRECHECK_V1);
    expect(m.calls[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    const h = new Headers(m.calls[0]!.init.headers);
    expect(h.get('authorization')).toBe('Bearer sk-or-test');
    expect(h.get('x-title')).toBe('Cooldown');
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({
      model: 'typesafe/jev-1.13',
      state: { pre_note: 'x' },
      questions: PRECHECK_V1,
    });
    expect(r.provider).toBe('openrouter');
    expect(r.answers.likely_impulse.noul).toBe(0.91);
    expect(r.answers.tilt_risk.score).toBe(1.62);
    expect(r.usage).toEqual({ input_tokens: 423, output_tokens: 70, cost: 0.000018 });
  });

  it('accepts fractional scores and maps them to the nearest rubric level', () => {
    expect(scoreLevel(1.62, 3)).toBe(2);
    expect(scoreLevel(0.69, 3)).toBe(1);
    expect(scoreLevel(0.2, 3)).toBe(0);
    expect(scoreLevel(9, 3)).toBe(2);
  });

  it('rejects a score outside the rubric', async () => {
    const bad = {
      ...okBody,
      answers: { ...okBody.answers, tilt_risk: { type: 'score', score: 3.2, confidence: 0.9 } },
    };
    const m = mockFetch([{ status: 200, body: bad }]);
    await expect(
      createJevClient(new OpenRouterJevTransport('k', undefined, { fetchImpl: m.impl }), noSleep).evaluate(
        {},
        PRECHECK_V1,
      ),
    ).rejects.toThrow(/failed validation/);
  });

  it('does not retry auth / credit errors', async () => {
    const m = mockFetch([
      { status: 401, body: { error: { code: 401, message: 'No auth credentials found' } } },
    ]);
    await expect(
      createJevClient(new OpenRouterJevTransport('k', undefined, { fetchImpl: m.impl }), noSleep).evaluate(
        {},
        PRECHECK_V1,
      ),
    ).rejects.toThrow(/401/);
    expect(m.calls).toHaveLength(1);
    const p = mockFetch([{ status: 402, body: { error: { code: 402, message: 'Insufficient credits' } } }]);
    await expect(
      createJevClient(new OpenRouterJevTransport('k', undefined, { fetchImpl: p.impl }), noSleep).evaluate(
        {},
        PRECHECK_V1,
      ),
    ).rejects.toThrow();
    expect(p.calls).toHaveLength(1);
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const m = mockFetch([
      { status: 429, body: { error: { code: 429, message: 'rate limited' } } },
      { status: 502, body: { error: { code: 502, message: 'upstream' } } },
      { status: 200, body: okBody },
    ]);
    const r = await createJevClient(
      new OpenRouterJevTransport('k', undefined, { fetchImpl: m.impl }),
      noSleep,
    ).evaluate({}, PRECHECK_V1);
    expect(m.calls).toHaveLength(3);
    expect(r.answers.likely_impulse.noul).toBe(0.91);
  });

  it('treats an error object in a 200 body as a failure', async () => {
    const m = mockFetch([{ status: 200, body: { error: { code: 400, message: 'bad question' } } }]);
    await expect(
      createJevClient(new OpenRouterJevTransport('k', undefined, { fetchImpl: m.impl }), noSleep).evaluate(
        {},
        PRECHECK_V1,
      ),
    ).rejects.toThrow();
    expect(m.calls).toHaveLength(1);
  });

  it('stored note labels use the nearest level and keep the raw score', async () => {
    const body = {
      answers: {
        primary_driver: {
          type: 'choice',
          choice: 'fomo',
          confidence: 0.82,
          probabilities: { fomo: 0.82, plan: 0.1 },
        },
        followed_own_plan: { type: 'noul', noul: 0.1 },
        impulsiveness: { type: 'score', score: 1.71, confidence: 0.9 },
        tilt_behaviour: { type: 'noul', noul: 0.88 },
      },
      usage: { input_tokens: 300, output_tokens: 40, cost: 0.00001 },
    };
    const m = mockFetch([{ status: 200, body }]);
    const r = await createJevClient(
      new OpenRouterJevTransport('k', undefined, { fetchImpl: m.impl }),
      noSleep,
    ).evaluate({}, LABEL_QUESTIONS);
    const l = toNoteLabels(r.answers);
    expect(l.impulsiveness).toMatchObject({
      score: 2,
      raw: 1.71,
      value: NOTE_CLASSIFIER_V1.impulsiveness.criteria[2],
    });
    expect(l.primary_driver.value).toBe('fomo');
  });

  it('requires a key', () => {
    expect(() => new OpenRouterJevTransport('')).toThrow(/OPENROUTER_API_KEY/);
  });
});
