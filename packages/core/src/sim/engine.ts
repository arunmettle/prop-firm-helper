import { RuleEngine } from '../rules/engine.js';
import type { Rules } from '../rules/schema.js';
import { BEHAVIOUR_DIMENSIONS, DIM_TEXT, type BehaviourDim, type DimProbs } from '../behaviour/types.js';
import { lossBucket } from '../behaviour/classify.js';
import { mulberry32, wilson } from './rng.js';
import { ARCHETYPES, archetypeProbs } from './archetypes.js';

export const SIM_VERSION = 'sim-v1';
export const MIN_HISTORY_FOR_PROFILE = 30;

export interface TraderSimRules {
  riskPct: number;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  tradingDaysPerWeek: number;
}

export interface MeasuredInputs {
  /** Smoothed probabilities keyed `${losses}|${band}`. */
  probs: Record<string, DimProbs>;
  planPool: number[];
  tiltPool: number[];
  tradesPerDay: number[];
  sizeUpMultiple: number | null;
  historyTrades: number;
  evidence: Record<BehaviourDim, string[]>;
}

export interface SimConfig {
  version: string;
  rules: Rules;
  startingBalance: number;
  trader: TraderSimRules;
  runs: number;
  seed: number;
  /** Horizon in calendar days when the rules have no calendar limit. */
  maxDays: number;
  measured: MeasuredInputs;
}

export interface Rate {
  p: number;
  lo: number;
  hi: number;
}

export interface ScenarioResult {
  id: string;
  label: string;
  kind: 'baseline' | 'measured' | 'sensitivity' | 'rule' | 'archetype';
  runs: number;
  pass: Rate;
  breach: Rate;
  timeout: Rate;
  breachByRule: Record<string, number>;
  /** breachByDay[d] = runs breached on calendar day d+1. */
  breachByDay: number[];
  medianPassDay: number | null;
  avgPeakDrawdownPct: number;
}

export interface Finding {
  id: string;
  label: string;
  from: number;
  to: number;
  delta: number;
  sentence: string;
  dim?: BehaviourDim;
}

export interface SimResult {
  version: string;
  illustrative: boolean;
  horizonDays: number;
  horizonIsRule: boolean;
  runs: number;
  seed: number;
  historyTrades: number;
  poolSizes: { plan: number; tilt: number };
  scenarios: ScenarioResult[];
  ranking: Finding[];
  ruleSweeps: Finding[];
  topEvidence: { dim: BehaviourDim; tradeIds: string[] } | null;
  elapsedMs: number;
}

interface ScenarioParams {
  id: string;
  label: string;
  kind: ScenarioResult['kind'];
  probs: Record<string, DimProbs> | null;
  zero: Set<BehaviourDim>;
  planPool: number[];
  tiltPool: number[];
  tradesPerDay: number[];
  trader: TraderSimRules;
  sizeUpMultiple: number;
}

const bandIndex = (dayPnl: number, dailyLimit: number, start: number): string => {
  const eps = start * 0.001;
  if (dayPnl > eps) return 'up';
  if (dayPnl >= -eps) return 'flat';
  return -dayPnl < dailyLimit * 0.5 ? 'down_lt50' : 'down_ge50';
};

const ZERO: DimProbs = { sizeUp: 0, extraTrade: 0, skipValid: 0, earlyClose: 0, widenStop: 0 };

/**
 * One scenario, many runs. Pure and deterministic for a given seed: run i always uses the stream
 * seeded with (seed, i), and every run draws the same random numbers in the same order regardless of the
 * probabilities (common random numbers) — so scenario differences come from behaviour, not noise.
 */
export function simulateScenario(cfg: Pick<SimConfig, 'rules' | 'startingBalance' | 'runs' | 'seed' | 'maxDays'>, sp: ScenarioParams): ScenarioResult {
  const { rules, startingBalance: S } = cfg;
  const horizon = rules.maxCalendarDays ?? cfg.maxDays;
  const dailyLimit = (S * rules.maxDailyLossPct) / 100;
  const labels = Array.from({ length: horizon + 1 }, (_, i) => `day ${i + 1}`);
  const probCache = new Map<string, DimProbs>();
  const probsFor = (key: string): DimProbs => {
    let p = probCache.get(key);
    if (!p) {
      const src = sp.probs?.[key] ?? ZERO;
      p = { ...src };
      for (const d of sp.zero) p[d] = 0;
      probCache.set(key, p);
    }
    return p;
  };
  const tpd = sp.tradesPerDay.length ? sp.tradesPerDay : [1];
  const plan = sp.planPool;
  const tilt = sp.tiltPool.length ? sp.tiltPool : sp.planPool;
  const { riskPct, maxTradesPerDay, stopAfterLosses, tradingDaysPerWeek } = sp.trader;

  let passed = 0;
  let breached = 0;
  let timedOut = 0;
  const byRule: Record<string, number> = { max_daily_loss: 0, max_loss: 0 };
  const byDay = new Array<number>(horizon).fill(0);
  const passDays: number[] = [];
  let ddSum = 0;

  for (let run = 0; run < cfg.runs; run++) {
    const rng = mulberry32((cfg.seed ^ Math.imul(run + 1, 0x9e3779b1)) >>> 0);
    const engine = new RuleEngine(rules, S);
    const target = engine.profitTargetBalance;
    let streak = 0;
    let peak = S;
    let maxDD = 0;
    for (let day = 0; day < horizon && !engine.terminal; day++) {
      engine.startDay(day);
      if (engine.terminal) break;
      if (day % 7 >= tradingDaysPerWeek) continue;
      const label = labels[day]!;
      if (engine.balance >= target - 0.005) {
        // Target reached but minimum trading days not yet: a minimal-risk trade just to count the day.
        engine.markTradingDay();
        engine.applyClosedTrade({ pnl: 0, label });
        continue;
      }
      let plannedLeft = tpd[Math.floor(rng() * tpd.length)]!;
      let tradesToday = 0;
      let lossesInRowToday = 0;
      let dayPnl = 0;
      let extraPending = false;
      let extras = 0;
      while (!engine.terminal) {
        let isExtra = false;
        if (extraPending) {
          isExtra = true;
          extraPending = false;
        } else if (plannedLeft > 0) {
          // Planned trades follow the trader's own rules.
          if (maxTradesPerDay !== null && tradesToday >= maxTradesPerDay) break;
          if (stopAfterLosses !== null && lossesInRowToday >= stopAfterLosses) break;
          plannedLeft--;
        } else break;
        const p = probsFor(`${lossBucket(streak)}|${bandIndex(dayPnl, dailyLimit, S)}`);
        const uSkip = rng();
        const uSize = rng();
        const uEarly = rng();
        const uWiden = rng();
        const uPick = rng();
        if (!isExtra && uSkip < p.skipValid) continue;
        const sizeUp = uSize < p.sizeUp;
        const early = uEarly < p.earlyClose;
        const widen = uWiden < p.widenStop;
        const tilted = isExtra || sizeUp || early || widen;
        const pool = tilted ? tilt : plan;
        let r = pool[Math.floor(uPick * pool.length)]!;
        if (widen && r < 0) r *= 1.5;
        if (early && r > 0) r *= 0.5;
        const risk = ((engine.balance * riskPct) / 100) * (sizeUp ? sp.sizeUpMultiple : 1);
        const pnl = r * risk;
        // Pessimistic intraday path: a losing trade touches its full stop (wider if moved) before closing.
        const worst = r < 0 ? Math.min(pnl, -risk * (widen ? 1.5 : 1)) : 0;
        if (tradesToday === 0) engine.markTradingDay();
        engine.applyClosedTrade({ pnl, worstPnl: worst, label });
        tradesToday++;
        dayPnl += pnl;
        if (pnl < 0) {
          streak++;
          lossesInRowToday++;
        } else {
          streak = 0;
          lossesInRowToday = 0;
        }
        if (engine.balance > peak) peak = engine.balance;
        const dd = (peak - engine.balance) / S;
        if (dd > maxDD) maxDD = dd;
        const uExtra = rng();
        const pe = probsFor(`${lossBucket(streak)}|${bandIndex(dayPnl, dailyLimit, S)}`).extraTrade;
        if (extras < 5 && uExtra < pe) {
          extraPending = true;
          extras++;
        }
      }
    }
    ddSum += maxDD;
    if (engine.passed) {
      passed++;
      passDays.push(Number(engine.passedAt!.slice(4)));
    } else if (engine.breached) {
      breached++;
      byRule[engine.breached.rule] = (byRule[engine.breached.rule] ?? 0) + 1;
      byDay[engine.breached.dayIndex] = (byDay[engine.breached.dayIndex] ?? 0) + 1;
    } else timedOut++;
  }
  passDays.sort((a, b) => a - b);
  return {
    id: sp.id,
    label: sp.label,
    kind: sp.kind,
    runs: cfg.runs,
    pass: wilson(passed, cfg.runs),
    breach: wilson(breached, cfg.runs),
    timeout: wilson(timedOut, cfg.runs),
    breachByRule: byRule,
    breachByDay: byDay,
    medianPassDay: passDays.length ? passDays[Math.floor(passDays.length / 2)]! : null,
    avgPeakDrawdownPct: (ddSum / cfg.runs) * 100,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Run every scenario for a config. Jev is never called here. */
export function runSimulation(cfg: SimConfig, now: () => number = () => Date.now()): SimResult {
  const t0 = now();
  const m = cfg.measured;
  const illustrative = m.historyTrades < MIN_HISTORY_FOR_PROFILE;
  const base = {
    trader: cfg.trader,
    sizeUpMultiple: Math.max(1.3, m.sizeUpMultiple ?? 1.5),
    zero: new Set<BehaviourDim>(),
  };
  const scenarios: ScenarioResult[] = [];
  let reference: ScenarioParams;

  if (!illustrative) {
    const pools = { planPool: m.planPool.length ? m.planPool : m.tiltPool, tiltPool: m.tiltPool, tradesPerDay: m.tradesPerDay };
    scenarios.push(simulateScenario(cfg, { ...base, ...pools, id: 'perfect', label: 'Perfect discipline', kind: 'baseline', probs: null, tiltPool: [] }));
    reference = { ...base, ...pools, id: 'measured', label: 'Your measured behaviour', kind: 'measured', probs: m.probs };
    scenarios.push(simulateScenario(cfg, reference));
  } else {
    const typical = ARCHETYPES.find((a) => a.id === 'typical')!;
    scenarios.push(
      simulateScenario(cfg, {
        ...base,
        id: 'perfect',
        label: 'Perfect discipline (example trades)',
        kind: 'baseline',
        probs: null,
        planPool: typical.planPool,
        tiltPool: [],
        tradesPerDay: typical.tradesPerDay,
      }),
    );
    for (const a of ARCHETYPES) {
      const sp: ScenarioParams = {
        ...base,
        id: `archetype_${a.id}`,
        label: a.label,
        kind: 'archetype',
        probs: archetypeProbs(a),
        planPool: a.planPool,
        tiltPool: a.tiltPool,
        tradesPerDay: a.tradesPerDay,
      };
      scenarios.push(simulateScenario(cfg, sp));
      if (a.id === 'typical') reference = sp;
    }
  }
  const ref = scenarios.find((s) => s.id === reference!.id)!;

  const ranking: Finding[] = [];
  for (const d of BEHAVIOUR_DIMENSIONS) {
    const s = simulateScenario(cfg, { ...reference!, id: `without_${d}`, label: DIM_TEXT[d].not, kind: 'sensitivity', zero: new Set([d]) });
    scenarios.push(s);
    ranking.push({
      id: s.id,
      dim: d,
      label: DIM_TEXT[d].not,
      from: ref.pass.p,
      to: s.pass.p,
      delta: s.pass.p - ref.pass.p,
      sentence: `${DIM_TEXT[d].not}: ${pct(ref.pass.p)} → ${pct(s.pass.p)}.`,
    });
  }
  ranking.sort((a, b) => b.delta - a.delta);

  const ruleSweeps: Finding[] = [];
  const tr = cfg.trader;
  const stopValues = [1, 2, 3].filter((v) => v !== tr.stopAfterLosses);
  for (const v of stopValues) {
    const s = simulateScenario(cfg, { ...reference!, id: `stop_after_${v}`, label: `Stop after ${v} loss${v > 1 ? 'es' : ''}`, kind: 'rule', trader: { ...tr, stopAfterLosses: v } });
    scenarios.push(s);
    const cur = tr.stopAfterLosses ? `${tr.stopAfterLosses}` : 'no limit';
    ruleSweeps.push({ id: s.id, label: s.label, from: ref.pass.p, to: s.pass.p, delta: s.pass.p - ref.pass.p, sentence: `Stop after ${v} loss${v > 1 ? 'es' : ''} in a row instead of ${cur}: ${pct(ref.pass.p)} → ${pct(s.pass.p)}.` });
  }
  for (const v of [0.5, 1].filter((x) => Math.abs(x - tr.riskPct) > 1e-9)) {
    const s = simulateScenario(cfg, { ...reference!, id: `risk_${v}`, label: `Risk ${v}% per trade`, kind: 'rule', trader: { ...tr, riskPct: v } });
    scenarios.push(s);
    ruleSweeps.push({ id: s.id, label: s.label, from: ref.pass.p, to: s.pass.p, delta: s.pass.p - ref.pass.p, sentence: `Risk ${v}% per trade instead of ${tr.riskPct}%: ${pct(ref.pass.p)} → ${pct(s.pass.p)}.` });
  }
  ruleSweeps.sort((a, b) => b.delta - a.delta);

  const top = ranking.find((r) => r.delta > 0 && r.dim && m.evidence[r.dim]?.length);
  return {
    version: SIM_VERSION,
    illustrative,
    horizonDays: cfg.rules.maxCalendarDays ?? cfg.maxDays,
    horizonIsRule: cfg.rules.maxCalendarDays !== null,
    runs: cfg.runs,
    seed: cfg.seed,
    historyTrades: m.historyTrades,
    poolSizes: { plan: m.planPool.length, tilt: m.tiltPool.length },
    scenarios,
    ranking,
    ruleSweeps,
    topEvidence: !illustrative && top?.dim ? { dim: top.dim, tradeIds: m.evidence[top.dim] } : null,
    elapsedMs: now() - t0,
  };
}
