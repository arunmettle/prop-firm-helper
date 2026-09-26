import { z } from 'zod';
import { round2, roundTo } from '../money.js';
import type { AccountEvaluation } from '../rules/evaluate.js';
import type { TraderRules } from '../settings.js';
import type { TodayStats } from '../trades/today.js';
import type { PointValue } from '../trades/instruments.js';
import type { GroupStat } from '../behaviour/types.js';
import { MIN_N } from '../behaviour/types.js';

export const precheckInputSchema = z
  .object({
    accountId: z.uuid(),
    instrument: z.string().trim().min(1).max(20).default('XAUUSD'),
    direction: z.enum(['long', 'short']),
    entry: z.number().positive().finite(),
    stop: z.number().positive().finite(),
    target: z.number().positive().finite().nullable().default(null),
    setupTag: z.string().trim().max(60).nullable().default(null),
    riskPct: z.number().positive().max(10),
    preNote: z.string().trim().min(3, 'Write one line on why — before you enter').max(500),
  })
  .superRefine((t, ctx) => {
    const dir = t.direction === 'long' ? 1 : -1;
    if ((t.stop - t.entry) * dir >= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['stop'],
        message:
          t.direction === 'long'
            ? 'Stop must be below entry for a long'
            : 'Stop must be above entry for a short',
      });
    if (t.target !== null && (t.target - t.entry) * dir <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message:
          t.direction === 'long'
            ? 'Target must be above entry for a long'
            : 'Target must be below entry for a short',
      });
  });
export type PrecheckInput = z.infer<typeof precheckInputSchema>;

export interface SizingResult {
  stopDistance: number;
  riskBudget: number;
  /** Rounded DOWN to the lot step so the actual risk never exceeds the chosen %. */
  positionSizeLots: number;
  actualRisk: number;
  actualRiskPct: number;
  rewardRisk: number | null;
  formula: string;
  tooSmall: boolean;
}

export function sizePosition(
  input: Pick<PrecheckInput, 'entry' | 'stop' | 'target' | 'riskPct'>,
  balance: number,
  pv: PointValue,
  currency: string,
  lotStep = 0.01,
): SizingResult {
  const dist = Math.abs(input.entry - input.stop);
  const budget = (balance * input.riskPct) / 100;
  const raw = budget / (dist * pv.valuePerPoint);
  const steps = Math.floor(raw / lotStep + 1e-9);
  const lots = roundTo(steps * lotStep, 8);
  const actualRisk = round2(lots * dist * pv.valuePerPoint);
  const money = (x: number) => `${x.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
  return {
    stopDistance: roundTo(dist, 8),
    riskBudget: round2(budget),
    positionSizeLots: lots,
    actualRisk,
    actualRiskPct: roundTo((actualRisk / balance) * 100, 3),
    rewardRisk: input.target !== null ? roundTo(Math.abs(input.target - input.entry) / dist, 2) : null,
    formula: `Size = (balance × risk %) ÷ (stop distance × value per point) = (${money(balance)} × ${input.riskPct}%) ÷ (${roundTo(dist, 5)} × ${pv.valuePerPoint}) = ${roundTo(raw, 4)} → ${lots} lots (rounded down to ${lotStep}). ${pv.formula}.`,
    tooSmall: lots <= 0,
  };
}

export interface PrecheckComputed {
  balance: number;
  sizing: SizingResult;
  positionSizeLots: number;
  dailyLossRemaining: number;
  dailyLossRemainingAfter: number;
  exceedsDailyBudget: boolean;
  exceedsMaxLoss: boolean;
  distanceToMaxLoss: number;
  maxLossFloor: number;
  accountStatus: AccountEvaluation['status'];
  tradesToday: number;
  maxTradesPerDay: number | null;
  consecutiveLossesToday: number;
  stopAfterLosses: number | null;
  minutesSinceLastLoss: number | null;
  cooldownMinutes: number;
  session: string;
  history: { setupTag: string | null; session: string; stat: GroupStat | null };
  baselineRisk: number | null;
  sizeAboveBaseline: boolean;
}

export interface PrecheckJevView {
  status: 'ok' | 'failed' | 'skipped';
  tilt_risk?: { value: string; score: number; confidence: number; uncertain: boolean };
  matches_stated_setup?: { p: number; uncertain: boolean };
  likely_impulse?: { p: number; uncertain: boolean };
}

export interface Reason {
  level: 'stop' | 'caution' | 'info';
  code: string;
  text: string;
}

export type Verdict = 'go' | 'caution' | 'stop';

export function buildComputed(args: {
  input: PrecheckInput;
  evaluation: AccountEvaluation;
  sizing: SizingResult;
  today: TodayStats;
  traderRules: TraderRules;
  session: string;
  history: GroupStat | null;
  baselineRisk: number | null;
}): PrecheckComputed {
  const { evaluation: e, sizing, today, traderRules: tr } = args;
  return {
    balance: e.balance,
    sizing,
    positionSizeLots: sizing.positionSizeLots,
    dailyLossRemaining: e.dailyLossRemaining,
    dailyLossRemainingAfter: e.dailyLossRemainingAfterOpen,
    exceedsDailyBudget: e.openTradeExceedsDaily,
    exceedsMaxLoss: e.openTradeExceedsMaxLoss,
    distanceToMaxLoss: e.distanceToMaxLoss,
    maxLossFloor: e.maxLossFloor,
    accountStatus: e.status,
    tradesToday: today.tradesToday,
    maxTradesPerDay: tr.maxTradesPerDay,
    consecutiveLossesToday: today.consecutiveLossesToday,
    stopAfterLosses: tr.stopAfterLosses,
    minutesSinceLastLoss: today.minutesSinceLastLoss,
    cooldownMinutes: tr.cooldownMinutes,
    session: args.session,
    history: { setupTag: args.input.setupTag, session: args.session, stat: args.history },
    baselineRisk: args.baselineRisk,
    sizeAboveBaseline:
      (args.baselineRisk !== null && sizing.actualRisk > 1.3 * args.baselineRisk) ||
      args.input.riskPct > tr.riskPct * 1.3,
  };
}

const fmtMoney = (x: number, c: string) =>
  `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

/**
 * Verdict logic lives in code, not in the model. The model's answers only add caution/stop reasons when
 * they are confident; a failed model call never changes the verdict silently — it adds an info reason.
 * Reasons are about the trader's own rules and state, never about the market or the trade idea.
 */
export function decideVerdict(
  c: PrecheckComputed,
  jev: PrecheckJevView,
  currency: string,
): { verdict: Verdict; reasons: Reason[] } {
  const reasons: Reason[] = [];
  if (c.accountStatus === 'breached')
    reasons.push({
      level: 'stop',
      code: 'account_breached',
      text: 'This account has already breached a rule.',
    });
  if (c.sizing.tooSmall)
    reasons.push({
      level: 'stop',
      code: 'size_too_small',
      text: 'At this risk % and stop distance the position rounds down to zero lots.',
    });
  if (c.exceedsDailyBudget)
    reasons.push({
      level: 'stop',
      code: 'daily_budget',
      text: `This trade risks ${fmtMoney(c.sizing.actualRisk, currency)}, more than the ${fmtMoney(c.dailyLossRemaining, currency)} left in today’s loss limit.`,
    });
  if (c.exceedsMaxLoss)
    reasons.push({
      level: 'stop',
      code: 'max_loss',
      text: `A full loss on this trade would take you below your max-loss floor (${fmtMoney(c.distanceToMaxLoss, currency)} of room left).`,
    });
  if (c.stopAfterLosses !== null && c.consecutiveLossesToday >= c.stopAfterLosses)
    reasons.push({
      level: 'stop',
      code: 'stop_after_losses',
      text: `You’ve had ${c.consecutiveLossesToday} losses in a row today — your rule is to stop after ${c.stopAfterLosses}.`,
    });
  if (c.maxTradesPerDay !== null && c.tradesToday >= c.maxTradesPerDay)
    reasons.push({
      level: 'stop',
      code: 'max_trades',
      text: `You’ve taken ${c.tradesToday} trades today — your limit is ${c.maxTradesPerDay}.`,
    });

  if (jev.status === 'ok') {
    const t = jev.tilt_risk;
    if (t && t.score >= 2 && t.confidence >= 0.6)
      reasons.push({
        level: 'stop',
        code: 'tilt_high',
        text: 'The tilt check reads your current state as high risk. A short break usually costs nothing.',
      });
    else if (t && t.score === 1 && t.confidence >= 0.6)
      reasons.push({
        level: 'caution',
        code: 'tilt_elevated',
        text: 'The tilt check reads your current state as elevated.',
      });
    if (jev.likely_impulse && jev.likely_impulse.p >= 0.65)
      reasons.push({
        level: 'caution',
        code: 'likely_impulse',
        text: 'Your note reads more like an impulse than a planned entry.',
      });
    if (jev.matches_stated_setup && !jev.matches_stated_setup.uncertain && jev.matches_stated_setup.p <= 0.35)
      reasons.push({
        level: 'info',
        code: 'no_setup_match',
        text: 'Your note doesn’t clearly describe one of your own setups.',
      });
  } else if (jev.status === 'failed') {
    reasons.push({
      level: 'info',
      code: 'jev_failed',
      text: 'The tilt check couldn’t run right now — this verdict uses your own rules only.',
    });
  }

  if (c.sizeAboveBaseline)
    reasons.push({
      level: 'caution',
      code: 'size_up',
      text: 'This is larger than your usual risk per trade.',
    });
  const h = c.history.stat;
  if (h && h.nR >= MIN_N && h.avgR !== null && h.avgR < 0)
    reasons.push({
      level: 'caution',
      code: 'history_negative',
      text: `Your past “${c.history.setupTag ?? 'untagged'}” trades in this session average ${h.avgR.toFixed(2)}R over ${h.n} trades.`,
    });
  if (c.minutesSinceLastLoss !== null && c.minutesSinceLastLoss < c.cooldownMinutes)
    reasons.push({
      level: 'caution',
      code: 'soon_after_loss',
      text: `Your last loss closed ${c.minutesSinceLastLoss} min ago (your cool-down is ${c.cooldownMinutes} min).`,
    });

  const verdict: Verdict = reasons.some((r) => r.level === 'stop')
    ? 'stop'
    : reasons.some((r) => r.level === 'caution')
      ? 'caution'
      : 'go';
  if (verdict === 'go')
    reasons.push({
      level: 'info',
      code: 'clear',
      text: 'Nothing in your rules or recent state flags this trade.',
    });
  return { verdict, reasons };
}
