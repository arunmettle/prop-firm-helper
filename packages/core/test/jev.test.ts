import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CloudflareJevTransport,
  createJevClient,
  defineQuestions,
  FakeJevTransport,
  isUncertain,
  JevError,
  LABEL_QUESTIONS,
  NOTE_CLASSIFIER_V1,
  PRECHECK_V1,
  toNoteLabels,
  TypesafeJevTransport,
  type JevTransport,
} from '../src/jev/index.js';

const noSleep = { sleep: async () => {} };

describe('jev client', () => {
  it('infers answer types from question definitions', async () => {
    const q = defineQuestions({
      urgent: { type: 'noul', instructions: 'x' },
      team: { type: 'choice', instructions: 'x', criteria: { billing: 'b', technical: 't' } },
      mood: { type: 'score', instructions: 'x', criteria: ['Calm', 'Angry'] },
    });
    const client = createJevClient(new FakeJevTransport(), noSleep);
    const r = await client.evaluate({ a: 1 }, q);
    expectTypeOf(r.answers.urgent.noul).toEqualTypeOf<number>();
    expectTypeOf(r.answers.team.choice).toEqualTypeOf<'billing' | 'technical'>();
    expectTypeOf(r.answers.mood.score).toEqualTypeOf<number>();
    expect(['billing', 'technical']).toContain(r.answers.team.choice);
  });

  it('the fake is deterministic', async () => {
    const c = createJevClient(new FakeJevTransport(), noSleep);
    const a = await c.evaluate({ pre_note: 'London breakout retest' }, NOTE_CLASSIFIER_V1);
    const b = await c.evaluate({ pre_note: 'London breakout retest' }, NOTE_CLASSIFIER_V1);
    expect(a.answers).toEqual(b.answers);
  });

  it('fake classifies notes with keyword heuristics', async () => {
    const c = createJevClient(new FakeJevTransport(), noSleep);
    const plan = await c.evaluate({ pre_note: 'NY open liquidity sweep then reclaim' }, LABEL_QUESTIONS);
    expect(plan.answers.primary_driver.choice).toBe('plan');
    expect(plan.answers.tilt_behaviour.noul).toBeLessThan(0.35);
    const rev = await c.evaluate({ pre_note: 'Need to make back the last loss' }, LABEL_QUESTIONS);
    expect(rev.answers.primary_driver.choice).toBe('revenge');
    expect(rev.answers.impulsiveness.score).toBe(2);
    const fomo = await c.evaluate(
      { pre_note: 'Missed the move, jumping in before it runs' },
      LABEL_QUESTIONS,
    );
    expect(fomo.answers.primary_driver.choice).toBe('fomo');
  });

  it('retries transient failures then succeeds', async () => {
    const t = new FakeJevTransport({ failTimes: 2 });
    const c = createJevClient(t, noSleep);
    const r = await c.evaluate({}, PRECHECK_V1);
    expect(t.calls).toBe(3);
    expect(r.answers.tilt_risk.score).toBeGreaterThanOrEqual(0);
  });

  it('gives up after two retries and never substitutes a value', async () => {
    const t = new FakeJevTransport({ failTimes: 5 });
    const c = createJevClient(t, noSleep);
    await expect(c.evaluate({}, PRECHECK_V1)).rejects.toBeInstanceOf(JevError);
    expect(t.calls).toBe(3);
  });

  it('rejects malformed responses (zod)', async () => {
    const c = createJevClient(new FakeJevTransport({ malformed: true }), noSleep);
    await expect(c.evaluate({}, PRECHECK_V1)).rejects.toThrow(/failed validation/);
  });

  it('rejects an out-of-range choice or score', async () => {
    const bad: JevTransport = {
      provider: 'fake',
      call: async () => ({
        answers: {
          primary_driver: { choice: 'panic', confidence: 0.9 },
          followed_own_plan: { noul: 0.5 },
          impulsiveness: { score: 7, confidence: 0.9 },
        },
      }),
    };
    await expect(createJevClient(bad, noSleep).evaluate({}, NOTE_CLASSIFIER_V1)).rejects.toThrow();
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    const t: JevTransport = {
      provider: 'typesafe',
      call: async () => {
        calls++;
        throw new JevError('nope', false);
      },
    };
    await expect(createJevClient(t, noSleep).evaluate({}, PRECHECK_V1)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('the typesafe stub throws a clear error', async () => {
    await expect(
      createJevClient(new TypesafeJevTransport('k'), noSleep).evaluate({}, PRECHECK_V1),
    ).rejects.toThrow(/not implemented/);
  });

  it('cloudflare adapter posts state+questions and unwraps the envelope', async () => {
    let captured: { url: string; body: unknown; auth: string | null } | null = null;
    const fetchMock = (async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('authorization'),
      };
      return new Response(
        JSON.stringify({
          success: true,
          result: { answers: { likely_impulse: { type: 'noul', noul: 0.2 } }, usage: { input_tokens: 120 } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const q = defineQuestions({ likely_impulse: PRECHECK_V1.likely_impulse });
    const r = await createJevClient(new CloudflareJevTransport('acc', 'tok', fetchMock), noSleep).evaluate(
      { x: 1 },
      q,
    );
    expect(captured!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/run/typesafe/jev');
    expect(captured!.auth).toBe('Bearer tok');
    expect(captured!.body).toEqual({ state: { x: 1 }, questions: q });
    expect(r.answers.likely_impulse.noul).toBe(0.2);
    expect(r.usage.input_tokens).toBe(120);
  });

  it('cloudflare adapter retries on 5xx and fails cleanly', async () => {
    let n = 0;
    const fetchMock = (async () => {
      n++;
      return new Response('{}', { status: 503 });
    }) as unknown as typeof fetch;
    await expect(
      createJevClient(new CloudflareJevTransport('a', 't', fetchMock), noSleep).evaluate({}, PRECHECK_V1),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });
});

describe('uncertainty rule', () => {
  it('flags choice/score confidence < 0.6 and noul in (0.35, 0.65)', () => {
    expect(isUncertain({ type: 'choice', confidence: 0.59 })).toBe(true);
    expect(isUncertain({ type: 'choice', confidence: 0.6 })).toBe(false);
    expect(isUncertain({ type: 'score', confidence: 0.3 })).toBe(true);
    expect(isUncertain({ type: 'noul', noul: 0.5 })).toBe(true);
    expect(isUncertain({ type: 'noul', noul: 0.65 })).toBe(false);
    expect(isUncertain({ type: 'noul', noul: 0.35 })).toBe(false);
    expect(isUncertain({ type: 'noul', noul: 0.9 })).toBe(false);
  });

  it('maps answers to stored labels with per-value uncertainty', async () => {
    const c = createJevClient(new FakeJevTransport(), noSleep);
    const r = await c.evaluate(
      { pre_note: 'Missed it, chasing, need to make back the last loss' },
      LABEL_QUESTIONS,
    );
    const l = toNoteLabels(r.answers);
    expect(l.primary_driver.uncertain).toBe(true); // conflicting signals
    expect(l.version).toMatch(/note-v1/);
  });
});
