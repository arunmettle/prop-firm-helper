import type { TradeDto } from '../lib/types';
import { Badge } from './ui';

const DRIVER_TEXT: Record<string, string> = {
  plan: 'Plan',
  fomo: 'FOMO',
  revenge: 'Revenge',
  fear: 'Fear',
  greed: 'Greed',
  boredom: 'Boredom',
  unclear: 'Unclear',
};

export function LabelChips({ trade }: { trade: TradeDto }) {
  if (trade.labelsStatus === 'pending')
    return <div className="mt-1 text-[11px] text-fg-subtle">classifying…</div>;
  if (trade.labelsStatus === 'failed')
    return <div className="mt-1 text-[11px] text-caution">couldn’t classify</div>;
  const l = trade.noteLabels;
  if (!l?.primary_driver) return null;
  const d = l.primary_driver;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge
        tone={
          d.uncertain ? 'neutral' : d.value === 'plan' ? 'go' : d.value === 'unclear' ? 'neutral' : 'caution'
        }
        title={`Note label (confidence ${(d.confidence * 100).toFixed(0)}%)${d.uncertain ? ' — uncertain, excluded from headline stats' : ''}`}
      >
        {DRIVER_TEXT[d.value] ?? d.value}
        {d.uncertain && ' · uncertain'}
      </Badge>
      {l.impulsiveness && !l.impulsiveness.uncertain && l.impulsiveness.score >= 1 && (
        <Badge tone={l.impulsiveness.score >= 2 ? 'caution' : 'neutral'}>{l.impulsiveness.value}</Badge>
      )}
    </div>
  );
}
