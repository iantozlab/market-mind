import React, { useEffect, useRef, useState } from 'react';
import { Radio, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadCSV } from '@/lib/exporters';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';


type State = 'armed' | 'triggered' | 'in-position' | 'cooling';

interface EventRow {
  id: string;
  ts: number;
  strategy: string;
  from: State;
  to: State;
  reason?: string;
}

const STATE_COLOR: Record<State, string> = {
  armed:         'text-muted-foreground',
  triggered:     'text-warning',
  'in-position': 'text-primary',
  cooling:       'text-info',
};
const STATE_DOT: Record<State, string> = {
  armed:         'bg-muted-foreground/60',
  triggered:     'bg-warning',
  'in-position': 'bg-primary',
  cooling:       'bg-info',
};

interface Props {
  strategies: StrategyStatus[];
  triggers: StrategyTrigger[];
  activePositions: number;
  isRunning: boolean;
}

const MAX_ROWS = 80;

const StrategyEventTimeline: React.FC<Props> = ({ strategies, triggers, activePositions, isRunning }) => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<'all' | State>('all');
  const stateRef = useRef<Record<string, State>>({});
  const seenTs = useRef<Record<string, number>>({});
  const coolTimers = useRef<Record<string, number>>({});

  // Ensure strategies default to 'armed' when first seen
  useEffect(() => {
    for (const s of strategies) {
      if (!stateRef.current[s.name]) stateRef.current[s.name] = s.active ? 'armed' : 'cooling';
    }
  }, [strategies]);

  // Handle triggers → transition to triggered / in-position
  useEffect(() => {
    if (!isRunning) return;
    const additions: EventRow[] = [];
    for (const t of triggers) {
      const prevTs = seenTs.current[t.strategy] || 0;
      if (t.ts <= prevTs) continue;
      seenTs.current[t.strategy] = t.ts;
      const from = stateRef.current[t.strategy] || 'armed';
      const to: State = activePositions > 0 ? 'in-position' : 'triggered';
      if (from !== to) {
        additions.push({
          id: `${t.strategy}-${t.ts}`,
          ts: t.ts,
          strategy: t.strategy,
          from,
          to,
          reason: t.reason,
        });
        stateRef.current[t.strategy] = to;
        coolTimers.current[t.strategy] = t.ts;
      }
    }
    if (additions.length) {
      setEvents(prev => [...additions.reverse(), ...prev].slice(0, MAX_ROWS));
    }
  }, [triggers, activePositions, isRunning]);

  // Cooling watchdog: transition stale non-armed states to cooling
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      const now = Date.now();
      const additions: EventRow[] = [];
      for (const name of Object.keys(stateRef.current)) {
        const cur = stateRef.current[name];
        const last = coolTimers.current[name] || 0;
        if (cur !== 'armed' && cur !== 'cooling' && now - last > 15_000) {
          additions.push({ id: `${name}-cool-${now}`, ts: now, strategy: name, from: cur, to: 'cooling' });
          stateRef.current[name] = 'cooling';
        } else if (cur === 'cooling' && now - last > 30_000) {
          additions.push({ id: `${name}-arm-${now}`, ts: now, strategy: name, from: 'cooling', to: 'armed' });
          stateRef.current[name] = 'armed';
          coolTimers.current[name] = now;
        }
      }
      if (additions.length) setEvents(prev => [...additions, ...prev].slice(0, MAX_ROWS));
    }, 2000);
    return () => clearInterval(id);
  }, [isRunning]);

  const visible = filter === 'all' ? events : events.filter(e => e.to === filter);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Strategy Event Timeline</h2>
        </div>
        <div className="flex items-center gap-1">
          {(['all','armed','triggered','in-position','cooling'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                filter === f ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={filter === f}
            >
              {f}
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={() => {
              const rows = visible.map(e => ({
                ts: new Date(e.ts).toISOString(),
                strategy: e.strategy,
                from: e.from,
                to: e.to,
                reason: e.reason ?? '',
              }));
              downloadCSV(`strategy-timeline-${Date.now()}.csv`, rows);
            }}
            aria-label="Export timeline as CSV"
            disabled={visible.length === 0}
          >
            <Download className="h-3 w-3 mr-1" />CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={() => {
              const blob = new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `strategy-timeline-${Date.now()}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
            aria-label="Export timeline as JSON"
            disabled={visible.length === 0}
          >
            <Download className="h-3 w-3 mr-1" />JSON
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEvents([])} aria-label="Clear timeline">
            <Trash2 className="h-3 w-3" />
          </Button>

        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isRunning ? 'Waiting for state transitions…' : 'Start the bot to record transitions.'}
        </p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {visible.map(e => (
            <li key={e.id} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 pb-1">
              <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[e.to]}`} />
              <span className="text-muted-foreground w-16 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="text-foreground capitalize truncate flex-1">{e.strategy.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">{e.from}</span>
              <span className="text-muted-foreground">→</span>
              <span className={`${STATE_COLOR[e.to]} uppercase`}>{e.to}</span>
              {e.reason && <span className="text-muted-foreground/80 truncate max-w-[140px]">· {e.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default StrategyEventTimeline;
