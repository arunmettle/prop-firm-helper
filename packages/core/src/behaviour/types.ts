import type { NoteLabels } from '../jev/labels.js';
import type { OverrideKind, ExitType } from '../trades/schema.js';

/** Minimal trade shape the behaviour engine needs (closed trades only). */
export interface BTrade {
  id: string;
  openedAt: Date | string;
  closedAt: Date | string;
  pnl: number;
  rMultiple: number | null;
  sizeLots: number;
  riskAmount: number | null;
  setupTag: string | null;
  exitType: ExitType;
  overrideFlag: boolean;
  overrideKind: OverrideKind | null;
  noteLabels: NoteLabels | null;
}

/** A pre-trade check that was NOT followed by a trade (possible "skipped" valid trade). */
export interface BPrecheck {
  createdAt: Date | string;
  verdict: 'go' | 'caution' | 'stop';
  linked: boolean;
}

export interface BehaviourContext {
  timezone: string;
  startingBalance: number;
  dailyLossLimit: number;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  cooldownMinutes: number;
}

export interface GroupStat {
  key: string;
  n: number;
  nR: number;
  winRate: number | null;
  avgR: number | null;
  netR: number;
  netPnl: number;
  tradeIds: string[];
}

export const MIN_N = 10;
export const MIN_BUCKET_N = 8;

export type LossBucket = '0' | '1' | '2' | '3+';
export type PnlBand = 'up' | 'flat' | 'down_lt50' | 'down_ge50';
export const LOSS_BUCKETS: LossBucket[] = ['0', '1', '2', '3+'];
export const PNL_BANDS: PnlBand[] = ['up', 'flat', 'down_lt50', 'down_ge50'];

export const BEHAVIOUR_DIMENSIONS = ['sizeUp', 'extraTrade', 'skipValid', 'earlyClose', 'widenStop'] as const;
export type BehaviourDim = (typeof BEHAVIOUR_DIMENSIONS)[number];
export type DimProbs = Record<BehaviourDim, number>;

export const DIM_TEXT: Record<BehaviourDim, { short: string; not: string }> = {
  sizeUp: { short: 'Sizing up (>1.3× your usual risk)', not: 'Not sizing up' },
  extraTrade: { short: 'Extra trades beyond your plan', not: 'No extra unplanned trades' },
  skipValid: { short: 'Skipping valid setups', not: 'Not skipping valid setups' },
  earlyClose: { short: 'Closing early by hand', not: 'Not closing early' },
  widenStop: { short: 'Moving stops wider', not: 'Not moving stops wider' },
};

export interface BucketProbs {
  losses: LossBucket;
  band: PnlBand;
  n: number;
  counts: Record<BehaviourDim, number>;
  opportunities: Record<BehaviourDim, number>;
  raw: DimProbs;
  smoothed: DimProbs;
  lowData: boolean;
}

export interface ConditionalProbs {
  version: string;
  baselineRisk: number | null;
  sizeBasis: 'risk' | 'lots';
  buckets: BucketProbs[];
  global: DimProbs;
  globalN: number;
  classification: { jev: number; heuristic: number };
}
