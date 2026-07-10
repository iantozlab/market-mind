import React from 'react';
import { Loader2, Cloud } from 'lucide-react';
import type { QueueItem } from '@/hooks/useMetricsPersistence';

interface Props {
  isReplaying: boolean;
  isFlushing: boolean;
  pendingQueue: QueueItem[];
}

const ReplayQueueProgressPanel: React.FC<Props> = ({ isReplaying, isFlushing, pendingQueue }) => {
  const queue = pendingQueue ?? [];
  if (!isReplaying && queue.length === 0) return null;
  const total = queue.length;
  const inflight = queue.filter(i => i.status === 'inflight').length;
  const pending = total - inflight;

  return (
    <div className="mt-3 rounded border border-info/40 bg-info/5 p-2 max-w-2xl" role="status" aria-live="polite">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-info">
          {isFlushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cloud className="h-3 w-3" />}
          Replay queue · {total} item{total === 1 ? '' : 's'}
        </div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {inflight} inflight · {pending} pending
        </div>
      </div>
      <ul className="space-y-0.5 max-h-24 overflow-y-auto">
        {pendingQueue.slice(0, 20).map((it, i) => (
          <li key={`${it.queued_at}-${i}`} className="flex items-center gap-2 text-[10px] font-mono">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                it.status === 'inflight' ? 'bg-info animate-pulse' : 'bg-warning'
              }`}
            />
            <span className="text-muted-foreground w-16 shrink-0">
              {it.queued_at ? new Date(it.queued_at).toLocaleTimeString() : '—'}
            </span>
            <span className="uppercase w-14 shrink-0">{it.status}</span>
            <span className="text-muted-foreground truncate">{it.session_id.slice(0, 8)}</span>
          </li>
        ))}
        {pendingQueue.length > 20 && (
          <li className="text-[10px] text-muted-foreground font-mono">…and {pendingQueue.length - 20} more</li>
        )}
      </ul>
    </div>
  );
};

export default ReplayQueueProgressPanel;
