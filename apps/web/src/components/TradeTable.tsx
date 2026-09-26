import clsx from 'clsx';
import { useNavigate } from 'react-router';
import { Flag } from 'lucide-react';
import { EXIT_LABELS, OVERRIDE_LABELS } from '@cooldown/core';
import { fmtDateTime, fmtMoney, fmtR } from '../lib/format';
import type { TradeDto } from '../lib/types';
import { Badge } from './ui';
import { LabelChips } from './LabelChips';

export function TradeTable({
  trades,
  currency,
  compact,
}: {
  trades: TradeDto[];
  currency: string;
  compact?: boolean;
}) {
  const nav = useNavigate();
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm" data-testid="trade-table">
        <thead className="text-left text-xs text-fg-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2.5 font-medium">Opened</th>
            <th className="px-3 py-2.5 font-medium">Trade</th>
            {!compact && <th className="px-3 py-2.5 text-right font-medium">Size</th>}
            {!compact && <th className="px-3 py-2.5 text-right font-medium">Entry → Exit</th>}
            <th className="px-3 py-2.5 text-right font-medium">R</th>
            <th className="px-3 py-2.5 text-right font-medium">P&L</th>
            <th className="px-3 py-2.5 font-medium">Setup</th>
            {!compact && <th className="px-3 py-2.5 font-medium">Note</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {trades.map((t) => (
            <tr
              key={t.id}
              onClick={() => nav(`/trades/${t.id}`)}
              className="cursor-pointer hover:bg-surface-2/60"
            >
              <td className="num px-3 py-2.5 whitespace-nowrap text-fg-muted">{fmtDateTime(t.openedAt)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <span
                  className={clsx('mr-1.5 font-medium', t.direction === 'long' ? 'text-go' : 'text-stop')}
                >
                  {t.direction === 'long' ? 'L' : 'S'}
                </span>
                <span className="font-medium">{t.instrument}</span>
                <span className="ml-2">
                  {t.exitType === 'open' ? (
                    <Badge tone="info">Open</Badge>
                  ) : (
                    <Badge>{EXIT_LABELS[t.exitType]}</Badge>
                  )}
                </span>
                {t.overrideFlag && (
                  <span
                    className="ml-1.5"
                    title={t.overrideKind ? OVERRIDE_LABELS[t.overrideKind] : 'Override'}
                  >
                    <Badge tone="caution">
                      <Flag className="size-3" />
                      {t.overrideKind ? OVERRIDE_LABELS[t.overrideKind] : 'Override'}
                    </Badge>
                  </span>
                )}
              </td>
              {!compact && <td className="num px-3 py-2.5 text-right">{t.sizeLots}</td>}
              {!compact && (
                <td className="num px-3 py-2.5 text-right whitespace-nowrap text-fg-muted">
                  {t.entryPrice} → {t.exitPrice ?? '—'}
                </td>
              )}
              <td
                className={clsx(
                  'num px-3 py-2.5 text-right font-medium',
                  (t.rMultiple ?? 0) > 0 ? 'text-go' : (t.rMultiple ?? 0) < 0 ? 'text-stop' : '',
                )}
              >
                {fmtR(t.rMultiple)}
              </td>
              <td
                className={clsx(
                  'num px-3 py-2.5 text-right whitespace-nowrap',
                  (t.pnl ?? 0) > 0 ? 'text-go' : (t.pnl ?? 0) < 0 ? 'text-stop' : '',
                )}
              >
                {fmtMoney(t.pnl, currency)}
              </td>
              <td className="px-3 py-2.5 text-fg-muted">{t.setupTag ?? '—'}</td>
              {!compact && (
                <td className="max-w-[320px] px-3 py-2.5">
                  <div className="truncate text-fg-muted" title={t.preNote ?? undefined}>
                    {t.preNote ?? (
                      <span className="text-fg-subtle italic">
                        {t.noteLabels ? 'note removed (privacy setting)' : '—'}
                      </span>
                    )}
                  </div>
                  <LabelChips trade={t} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
