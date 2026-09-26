import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../lib/api';
import type { TradeDto } from '../lib/types';
import { TradeTable } from './TradeTable';
import { Spinner } from './ui';

/** Slide-over listing the actual historical trades behind a finding. */
export function EvidenceDrawer({
  title,
  ids,
  currency,
  onClose,
}: {
  title: string;
  ids: string[] | null;
  currency: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['evidence', ids],
    queryFn: () => api.post<TradeDto[]>('/api/trades/by-ids', { ids: ids!.slice(0, 500) }),
    enabled: !!ids?.length,
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  if (!ids) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex h-full w-full max-w-4xl flex-col border-l border-line bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <div className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Evidence</div>
            <h2 className="mt-0.5 text-[15px] font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-fg-muted">{ids.length} trades from your own history</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {q.isLoading ? <Spinner /> : q.data && <TradeTable trades={q.data} currency={currency} />}
        </div>
      </div>
    </div>
  );
}
