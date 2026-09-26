import type { EnrichedTrade, TradeBehaviour } from './classify.js';
import { lossBucket, pnlBand } from './classify.js';
import {
  BEHAVIOUR_DIMENSIONS,
  LOSS_BUCKETS,
  MIN_BUCKET_N,
  PNL_BANDS,
  type BPrecheck,
  type BehaviourContext,
  type BehaviourDim,
  type BucketProbs,
  type ConditionalProbs,
  type DimProbs,
} from './types.js';
import { dayKey } from '../time.js';

const zero = (): Record<BehaviourDim, number> => ({ sizeUp: 0, extraTrade: 0, skipValid: 0, earlyClose: 0, widenStop: 0 });

/**
 * Bucket each historical trade by the state it was taken in (losses in a row × today's P&L band) and count how
 * often each behaviour happened. Buckets with < 8 observations are blended with neighbouring buckets and flagged.
 */
export function buildConditionalProbs(
  et: EnrichedTrade[],
  beh: Map<string, TradeBehaviour>,
  prechecks: BPrecheck[],
  ctx: BehaviourContext,
  baseline: number | null,
  sizeBasis: 'risk' | 'lots',
): ConditionalProbs {
  const key = (l: string, b: string) => `${l}|${b}`;
  const counts = new Map<string, Record<BehaviourDim, number>>();
  const opps = new Map<string, Record<BehaviourDim, number>>();
  const ns = new Map<string, number>();
  for (const l of LOSS_BUCKETS) for (const b of PNL_BANDS) {
    counts.set(key(l, b), zero());
    opps.set(key(l, b), zero());
    ns.set(key(l, b), 0);
  }
  for (const t of et) {
    const k = key(t.losses, t.band);
    const c = counts.get(k)!;
    const o = opps.get(k)!;
    const bh = beh.get(t.id)!;
    ns.set(k, ns.get(k)! + 1);
    for (const d of BEHAVIOUR_DIMENSIONS) if (d !== 'skipValid') o[d]++;
    if (bh.sizeUp) c.sizeUp++;
    if (bh.extraTrade) c.extraTrade++;
    if (bh.earlyClose) c.earlyClose++;
    if (bh.widenStop) c.widenStop++;
    o.skipValid++; // every taken trade is an opportunity that was NOT skipped
  }
  // Unlinked go/caution prechecks = setups the trader checked and then didn't take.
  const byClose = [...et].sort((a, b) => a.close - b.close);
  for (const p of prechecks) {
    if (p.linked || p.verdict === 'stop') continue;
    const at = new Date(p.createdAt).getTime();
    const prior = byClose.filter((t) => t.close <= at);
    let streak = 0;
    for (let i = prior.length - 1; i >= 0; i--) {
      if (prior[i]!.pnl < 0) streak++;
      else break;
    }
    const day = dayKey(at, ctx.timezone);
    const dayPnl = prior.filter((t) => dayKey(t.close, ctx.timezone) === day).reduce((s, t) => s + t.pnl, 0);
    const k = key(lossBucket(streak), pnlBand(dayPnl, ctx.dailyLossLimit, ctx.startingBalance));
    counts.get(k)!.skipValid++;
    opps.get(k)!.skipValid++;
  }

  const total = zero();
  const totalOpp = zero();
  for (const k of counts.keys()) for (const d of BEHAVIOUR_DIMENSIONS) {
    total[d] += counts.get(k)![d];
    totalOpp[d] += opps.get(k)![d];
  }
  const global: DimProbs = zero();
  for (const d of BEHAVIOUR_DIMENSIONS) global[d] = totalOpp[d] ? total[d] / totalOpp[d] : 0;

  const neighbours = (l: string, b: string) => {
    const li = LOSS_BUCKETS.indexOf(l as never);
    const bi = PNL_BANDS.indexOf(b as never);
    const out: string[] = [];
    if (li > 0) out.push(key(LOSS_BUCKETS[li - 1]!, b));
    if (li < LOSS_BUCKETS.length - 1) out.push(key(LOSS_BUCKETS[li + 1]!, b));
    if (bi > 0) out.push(key(l, PNL_BANDS[bi - 1]!));
    if (bi < PNL_BANDS.length - 1) out.push(key(l, PNL_BANDS[bi + 1]!));
    return out;
  };

  const buckets: BucketProbs[] = [];
  for (const l of LOSS_BUCKETS) for (const b of PNL_BANDS) {
    const k = key(l, b);
    const c = counts.get(k)!;
    const o = opps.get(k)!;
    const raw = zero();
    const smoothed = zero();
    let lowData = false;
    for (const d of BEHAVIOUR_DIMENSIONS) {
      raw[d] = o[d] ? c[d] / o[d] : 0;
      if (o[d] >= MIN_BUCKET_N) {
        smoothed[d] = raw[d];
        continue;
      }
      lowData = true;
      // Blend: pad this bucket up to MIN_BUCKET_N pseudo-observations from its neighbours (or global if they're empty).
      let nc = 0;
      let no = 0;
      for (const nk of neighbours(l, b)) {
        nc += counts.get(nk)![d];
        no += opps.get(nk)![d];
      }
      const prior = no > 0 ? nc / no : global[d];
      const k0 = MIN_BUCKET_N - o[d];
      smoothed[d] = (c[d] + k0 * prior) / (o[d] + k0);
    }
    buckets.push({ losses: l, band: b, n: ns.get(k)!, counts: c, opportunities: o, raw, smoothed, lowData });
  }
  const evidence: Record<BehaviourDim, string[]> = { sizeUp: [], extraTrade: [], skipValid: [], earlyClose: [], widenStop: [] };
  const upMultiples: number[] = [];
  for (const t of et) {
    const bh = beh.get(t.id)!;
    if (bh.sizeUp) {
      evidence.sizeUp.push(t.id);
      if (baseline) upMultiples.push(t.size / baseline);
    }
    if (bh.extraTrade) evidence.extraTrade.push(t.id);
    if (bh.earlyClose) evidence.earlyClose.push(t.id);
    if (bh.widenStop) evidence.widenStop.push(t.id);
  }
  let jev = 0;
  let heuristic = 0;
  for (const v of beh.values()) {
    if (v.source === 'jev') jev++;
    else heuristic++;
  }
  return {
    version: 'cond-v1',
    baselineRisk: baseline,
    sizeBasis,
    buckets,
    global,
    globalN: et.length,
    classification: { jev, heuristic },
    evidence,
    sizeUpMultiple: upMultiples.length ? upMultiples.reduce((a, b) => a + b, 0) / upMultiples.length : null,
  };
}
