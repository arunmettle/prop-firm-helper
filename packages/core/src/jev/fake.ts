import type { JevTransport, Questions } from './types.js';

/** FNV-1a 32-bit → [0, 1). Deterministic, isomorphic (no node:crypto). */
export function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

const KW: [string, RegExp][] = [
  [
    'revenge',
    /(make (it )?back|win (it )?back|recover|revenge|get it back|last loss|made back|back to even)/,
  ],
  [
    'fomo',
    /(missed|chasing|chase|flying|running|before it runs|fomo|getting in now|late entry|jump(ing)? in)/,
  ],
  ['fear', /(nervous|scared|afraid|anxious|panic|fear|couldn'?t watch|got out early)/],
  ['greed', /(bigger|more size|add(ed|ing)? (more|size)|let it run|greedy|double|going big)/],
  ['boredom', /(bored|nothing to do|just a scalp|small scalp|why not|something to do)/],
  [
    'plan',
    /(setup|retest|structure|confirm|plan|level|demand|supply|sweep|reclaim|breakout|range|pullback|trend|as planned|rule)/,
  ],
];

type S = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const get = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as S)[k] : undefined), o);

function classifyNote(state: S, u: (k: string) => number) {
  const text = `${state.pre_note ?? ''} ${state.override_note ?? ''}`.toLowerCase().trim();
  const hits = KW.filter(([, re]) => re.test(text)).map(([k]) => k);
  const nonPlan = hits.filter((h) => h !== 'plan');
  const sinceLoss = num(state.minutes_since_previous_loss);
  let driver = 'unclear';
  let confidence = 0.62 + u('c0') * 0.1;
  if (nonPlan.length === 1) {
    driver = nonPlan[0]!;
    confidence = 0.74 + u('c1') * 0.2;
  } else if (nonPlan.length > 1) {
    driver = nonPlan[0]!;
    confidence = 0.45 + u('c2') * 0.1; // conflicting signals → uncertain
  } else if (hits.includes('plan')) {
    driver = 'plan';
    confidence = sinceLoss !== null && sinceLoss < 10 ? 0.55 : 0.78 + u('c3') * 0.17;
  } else if (!text) {
    driver = 'unclear';
    confidence = 0.8;
  } else if (sinceLoss !== null && sinceLoss < 20) {
    driver = 'revenge';
    confidence = 0.6 + u('c4') * 0.1;
  }
  if (state.override_kind === 'closed_early' && driver === 'unclear' && /nervous|scared|worried/.test(text))
    driver = 'fear';
  return { driver, confidence: Math.min(0.97, confidence), text };
}

/**
 * Deterministic fake used in dev (no API key) and in every test. Answers derive from a hash of the input plus
 * simple keyword heuristics so demos look sensible. It is NOT a model.
 */
export class FakeJevTransport implements JevTransport {
  readonly provider = 'fake' as const;
  calls = 0;
  constructor(private opts: { failTimes?: number; malformed?: boolean } = {}) {}

  async call(state: unknown, questions: Questions) {
    this.calls++;
    if (this.opts.failTimes && this.calls <= this.opts.failTimes) throw new Error('fake transport failure');
    const stateStr = JSON.stringify(state ?? null);
    const u = (k: string) => hashUnit(stateStr + '|' + k);
    const s = (state ?? {}) as S;
    const note = classifyNote(s, u);
    const answers: Record<string, unknown> = {};
    for (const [key, q] of Object.entries(questions)) {
      if (this.opts.malformed) {
        answers[key] = { type: q.type, oops: true };
        continue;
      }
      answers[key] = this.answer(key, q, s, note, u);
    }
    return {
      answers,
      usage: {
        input_tokens: Math.ceil(stateStr.length / 4) + 40 * Object.keys(questions).length,
        output_tokens: 6 * Object.keys(questions).length,
      },
    };
  }

  private answer(
    key: string,
    q: Questions[string],
    s: S,
    note: ReturnType<typeof classifyNote>,
    u: (k: string) => number,
  ) {
    const tilted = ['revenge', 'fomo', 'greed', 'boredom'].includes(note.driver);
    const consec = num(get(s, 'today.consecutive_losses')) ?? 0;
    const sinceLoss = num(get(s, 'today.minutes_since_last_loss')) ?? num(s.minutes_since_previous_loss);
    switch (key) {
      case 'primary_driver':
        return {
          type: 'choice',
          choice: note.driver,
          confidence: note.confidence,
          probabilities: { [note.driver]: note.confidence },
        };
      case 'followed_own_plan':
        return {
          type: 'noul',
          noul: note.driver === 'plan' ? 0.8 + u(key) * 0.15 : tilted ? 0.08 + u(key) * 0.15 : 0.5,
        };
      case 'impulsiveness': {
        const score = note.driver === 'plan' ? 0 : tilted ? 2 : 1;
        return {
          type: 'score',
          score,
          confidence: 0.66 + u(key) * 0.25,
          legend: q.type === 'score' ? q.criteria[score] : undefined,
        };
      }
      case 'override_justified':
        return {
          type: 'noul',
          noul: /(news|rule|plan|as planned|time stop|end of (session|day))/.test(note.text) ? 0.86 : 0.18,
        };
      case 'tilt_behaviour': {
        const size = num(s.size_vs_user_average) ?? 1;
        let p = note.driver === 'plan' ? 0.12 : tilted ? 0.84 : 0.5;
        if (size > 1.3 && sinceLoss !== null && sinceLoss < 30) p = Math.max(p, 0.8);
        return { type: 'noul', noul: Math.min(0.97, p + u(key) * 0.05) };
      }
      case 'tilt_risk': {
        let score = 0;
        if (consec >= 1 || tilted) score = 1;
        if (consec >= 2 || (sinceLoss !== null && sinceLoss < 15) || (tilted && consec >= 1)) score = 2;
        return {
          type: 'score',
          score,
          confidence: 0.64 + u(key) * 0.3,
          legend: q.type === 'score' ? q.criteria[score] : undefined,
        };
      }
      case 'matches_stated_setup': {
        const setups = [...((s.stated_setups as string[] | undefined) ?? []), String(s.setup_tag ?? '')]
          .join(' ')
          .toLowerCase();
        const words = note.text.split(/\W+/).filter((w) => w.length > 3);
        const overlap = words.some((w) => setups.includes(w));
        return { type: 'noul', noul: overlap ? 0.82 + u(key) * 0.1 : note.driver === 'plan' ? 0.55 : 0.15 };
      }
      case 'likely_impulse':
        return {
          type: 'noul',
          noul: tilted
            ? 0.82
            : sinceLoss !== null && sinceLoss < 15
              ? 0.7
              : note.driver === 'plan'
                ? 0.12 + u(key) * 0.1
                : 0.4,
        };
    }
    // Generic deterministic answers for any other question.
    const x = u(key);
    if (q.type === 'noul') return { type: 'noul', noul: x };
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      return { type: 'choice', choice: keys[Math.floor(x * keys.length)], confidence: 0.5 + x * 0.5 };
    }
    return { type: 'score', score: Math.floor(x * q.criteria.length), confidence: 0.5 + x * 0.5 };
  }
}
