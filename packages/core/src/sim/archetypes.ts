import type { BehaviourDim, DimProbs, LossBucket, PnlBand } from '../behaviour/types.js';
import { LOSS_BUCKETS, PNL_BANDS } from '../behaviour/types.js';

/**
 * Example behaviour archetypes, used ONLY when the trader has < 30 closed trades.
 * These are illustrative presets (plain data), not anyone's measured behaviour.
 */
export interface Archetype {
  id: 'disciplined' | 'typical' | 'tilt_prone';
  label: string;
  description: string;
  /** Probability of each behaviour at 0 / 1 / 2 / 3+ losses in a row (P&L band adds a small bump when down). */
  byLosses: Record<BehaviourDim, [number, number, number, number]>;
  planPool: number[];
  tiltPool: number[];
  tradesPerDay: number[];
}

const PLAN_POOL = [2, 2, 2, 1.5, 1, 0.5, 0, -1, -1, -1, -1, -0.5, 2, -1, 1.8, -1, 2.2, -1, 0.8, -1];
const TILT_POOL = [1, -1, -1, -1, -1.2, 0.5, -1, -0.6, 1.5, -1, -1, 0.3];

export const ARCHETYPES: Archetype[] = [
  {
    id: 'disciplined',
    label: 'Disciplined (example)',
    description: 'Rarely changes behaviour after losses.',
    byLosses: {
      sizeUp: [0, 0.02, 0.03, 0.05],
      extraTrade: [0.01, 0.03, 0.05, 0.08],
      skipValid: [0.02, 0.03, 0.05, 0.05],
      earlyClose: [0.03, 0.04, 0.05, 0.06],
      widenStop: [0, 0.01, 0.02, 0.03],
    },
    planPool: PLAN_POOL,
    tiltPool: TILT_POOL,
    tradesPerDay: [1, 1, 2, 2, 2],
  },
  {
    id: 'typical',
    label: 'Typical (example)',
    description: 'Some sizing up and extra trades after a loss or two.',
    byLosses: {
      sizeUp: [0.02, 0.15, 0.25, 0.35],
      extraTrade: [0.05, 0.2, 0.3, 0.4],
      skipValid: [0.05, 0.08, 0.1, 0.12],
      earlyClose: [0.08, 0.12, 0.15, 0.18],
      widenStop: [0.02, 0.06, 0.1, 0.12],
    },
    planPool: PLAN_POOL,
    tiltPool: TILT_POOL,
    tradesPerDay: [1, 2, 2, 2, 3],
  },
  {
    id: 'tilt_prone',
    label: 'Tilt-prone (example)',
    description: 'Behaviour changes sharply after losses.',
    byLosses: {
      sizeUp: [0.05, 0.35, 0.5, 0.6],
      extraTrade: [0.1, 0.4, 0.55, 0.65],
      skipValid: [0.05, 0.1, 0.15, 0.2],
      earlyClose: [0.12, 0.2, 0.25, 0.3],
      widenStop: [0.05, 0.15, 0.25, 0.3],
    },
    planPool: PLAN_POOL,
    tiltPool: TILT_POOL,
    tradesPerDay: [1, 2, 2, 3, 3],
  },
];

export function archetypeProbs(a: Archetype): Record<string, DimProbs> {
  const out: Record<string, DimProbs> = {};
  LOSS_BUCKETS.forEach((l: LossBucket, li) => {
    PNL_BANDS.forEach((b: PnlBand) => {
      const bump = b === 'down_ge50' ? 1.2 : b === 'down_lt50' ? 1.1 : 1;
      const p = {} as DimProbs;
      for (const d of Object.keys(a.byLosses) as BehaviourDim[])
        p[d] = Math.min(0.95, a.byLosses[d][li]! * bump);
      out[`${l}|${b}`] = p;
    });
  });
  return out;
}
