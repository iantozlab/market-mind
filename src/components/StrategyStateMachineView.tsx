import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';

type State = 'armed' | 'triggered' | 'in-position' | 'cooling';

interface Row {
  name: string;
  state: State;
  counters: Record<State, number>;
  lastTransition: number;
}

interface Props {
  strategies: StrategyStatus[];
  triggers: StrategyTrigger[];
  isRunning: boolean;
  activePositions: number;
}

const STATE_COLOR: Record<State, string> = {
  armed:        'bg-muted-foreground/60',
  triggered:    'bg-warning',
  'in-position':'bg-primary',
  cooling:      'bg-info',
};

const StrategyStateMachineView: React.FC<Props> = ({ strategies, triggers, isRunning, activePositions }) => {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const seenTs = useRef<Record<string, number>>({});

  useEffect(() => {
    setRows(prev => {
      const next = { ...prev };
      for (const s of strategies) {
        if (!next[s.name]) {
          next[s.name] = {
            name: s.name,
            state: s.active ? 'armed' : 'cooling',
            counters: { armed: 0, triggered: 0, 'in-position': 0, cooling: 0 },
            lastTransition: Date.now(),
          };
        }
      }
      // ingest fresh triggers
      for (const t of triggers) {
        const prevTs = seenTs.current[t.strategy] || 0;
        if (t.ts > prevTs) {
          seenTs.current[t.strategy] = t.ts;
          const r = next[t.strategy];
          if (r) {
            const newState: State = activePositions > 0 ? 'in-position' : 'triggered';
            r.counters[newState] = (r.counters[newState] || 0) + 1;
            r.state = newState;
            r.lastTransition = t.ts;
          }
        } else {
          const r = next[t.strategy];
          if (r && isRunning && Date.now() - r.lastTransition > 15_000 && r.state !== 'armed') {
            r.counters.cooling = (r.counters.cooling || 0) + (r.state !== 'cooling' ? 1 : 0);
            r.state = 'cooling';
            r.lastTransition = Date.now();
          }
        }
      }
      return { ...next };
    });
  }, [strategies, triggers, activePositions, isRunning]);

  const list = Object.values(rows);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-accent" />
        <h2 className="font-display text-sm font-semibold tracking-wide">Strategy State Machines</h2>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">Start the bot to view state transitions.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {list.map(r => (
            <div key={r.name} className="rounded border border-border bg-background/40 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-display capitalize">{r.name.replace(/_/g, ' ')}</span>
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{r.state}</span>
              </div>
              <div className="flex items-center gap-1 mb-1.5">
                {(['armed','triggered','in-position','cooling'] as State[]).map(s => (
                  <div key={s} className="flex-1">
                    <div className={`h-1 rounded-full ${r.state === s ? STATE_COLOR[s] : 'bg-border'}`} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-1 text-center">
                {(['armed','triggered','in-position','cooling'] as State[]).map(s => (
                  <div key={s} className="rounded bg-background/60 py-0.5">
                    <div className="text-[8px] uppercase text-muted-foreground">{s.replace('-', '·')}</div>
                    <div className="text-[10px] font-mono text-foreground">{r.counters[s] || 0}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StrategyStateMachineView;
