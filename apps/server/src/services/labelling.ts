import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  LABEL_QUESTIONS,
  LABEL_QUESTIONS_WITH_OVERRIDE,
  NOTE_LABELS_VERSION,
  toNoteLabels,
} from '@cooldown/core/jev';
import { dayKey, parseUserSettings, ruleSchema } from '@cooldown/core';
import type { Tx } from '../db/client.js';
import type { AppCtx } from '../ctx.js';
import { accounts, prechecks, trades, users, type Trade } from '../db/schema.js';
import { enqueue } from '../jobs/queue.js';
import { callJev } from './jev.js';

const hasText = (t: Pick<Trade, 'preNote' | 'overrideNote'>) => !!(t.preNote?.trim() || t.overrideNote?.trim());

/** Called whenever trades are created/updated/imported: queue note classification. */
export async function onTradesChanged(_ctx: AppCtx, tx: Tx, userId: string, tradeIds: string[]): Promise<void> {
  if (!tradeIds.length) return;
  const rows = await tx
    .select({ id: trades.id, preNote: trades.preNote, overrideNote: trades.overrideNote })
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.id, tradeIds)));
  const withText = rows.filter(hasText).map((r) => r.id);
  const without = rows.filter((r) => !hasText(r)).map((r) => r.id);
  if (without.length)
    await tx
      .update(trades)
      .set({ labelsStatus: 'none', noteLabels: null, labelsVersion: null })
      .where(and(eq(trades.userId, userId), inArray(trades.id, without)));
  if (withText.length) {
    await tx
      .update(trades)
      .set({ labelsStatus: 'pending' })
      .where(and(eq(trades.userId, userId), inArray(trades.id, withText)));
    for (let i = 0; i < withText.length; i += 25) {
      await enqueue(tx, 'label_trades', { userId, tradeIds: withText.slice(i, i + 25) });
    }
  }
}

/** Build the NOTE_CLASSIFIER_V1 state for one trade from its account history. No identity, no ids. */
export function buildLabelState(trade: Trade, history: Trade[], tz: string, precheck: { verdict: string; tilt_risk?: string } | null) {
  const earlier = history.filter((t) => t.openedAt < trade.openedAt);
  const lastLoss = [...earlier].reverse().find((t) => t.closedAt && t.closedAt <= trade.openedAt && (t.pnl ?? 0) < 0);
  const today = dayKey(trade.openedAt, tz);
  const sizes = history.map((t) => t.sizeLots);
  const avg = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);
  return {
    pre_note: trade.preNote ?? '',
    override_kind: trade.overrideFlag ? trade.overrideKind : null,
    override_note: trade.overrideFlag ? (trade.overrideNote ?? '') : null,
    exit_type: trade.exitType,
    r_multiple: trade.rMultiple,
    minutes_since_previous_loss: lastLoss ? Math.round((trade.openedAt.getTime() - lastLoss.closedAt!.getTime()) / 60_000) : null,
    trades_earlier_today: earlier.filter((t) => dayKey(t.openedAt, tz) === today).length,
    size_vs_user_average: avg > 0 ? Math.round((trade.sizeLots / avg) * 100) / 100 : 1,
    precheck,
  };
}

export async function labelTradesJob(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const userId = String(payload.userId);
  const ids = (payload.tradeIds as string[]) ?? [];
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  const settings = parseUserSettings(user.settings);
  const targets = await ctx.db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.id, ids), eq(trades.labelsStatus, 'pending')));
  if (!targets.length) return;

  const accountIds = [...new Set(targets.map((t) => t.accountId))];
  const accRows = await ctx.db.select().from(accounts).where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
  const history = await ctx.db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), inArray(trades.accountId, accountIds)))
    .orderBy(asc(trades.openedAt));
  const pcs = await ctx.db
    .select({ tradeId: prechecks.linkedTradeId, verdict: prechecks.verdict, jev: prechecks.jev })
    .from(prechecks)
    .where(and(eq(prechecks.userId, userId), inArray(prechecks.linkedTradeId, ids)));

  for (const t of targets) {
    const acc = accRows.find((a) => a.id === t.accountId);
    const tz = acc ? ruleSchema.parse(acc.rules).dayResetTimezone : 'UTC';
    const pc = pcs.find((p) => p.tradeId === t.id);
    const pcJev = pc?.jev as { tilt_risk?: { value?: string } } | null | undefined;
    const state = buildLabelState(
      t,
      history.filter((h) => h.accountId === t.accountId),
      tz,
      pc ? { verdict: pc.verdict, tilt_risk: pcJev?.tilt_risk?.value } : null,
    );
    try {
      const questions = t.overrideFlag ? LABEL_QUESTIONS_WITH_OVERRIDE : LABEL_QUESTIONS;
      const r = await callJev(ctx, userId, 'note_classifier', state, questions);
      const labels = toNoteLabels(r.answers);
      await ctx.db
        .update(trades)
        .set({
          noteLabels: labels,
          labelsVersion: NOTE_LABELS_VERSION,
          labelsStatus: 'done',
          // Privacy: when the user opts out of keeping raw notes, keep only the labels.
          ...(settings.keepRawNotes ? {} : { preNote: null, overrideNote: null }),
        })
        .where(and(eq(trades.id, t.id), eq(trades.userId, userId)));
    } catch {
      // Never substitute a guessed value: mark as failed, UI shows "couldn't classify", user can re-label.
      await ctx.db
        .update(trades)
        .set({ labelsStatus: 'failed' })
        .where(and(eq(trades.id, t.id), eq(trades.userId, userId)));
    }
  }
}
