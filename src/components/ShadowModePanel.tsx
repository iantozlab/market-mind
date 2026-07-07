import React, { useEffect, useState } from 'react';
import { EyeOff, Eye, RotateCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import Sparkline from '@/components/Sparkline';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';

const KEY = 'shadow_mode_strategies_v1';

interface ShadowStats {
  signals: number;
  hypoPnL: number;
  lastTs: number;
  pnlSeries: number[];
  signalSeries: number[];
}

interface Props {
  strategies: StrategyStatus[];
  triggers: StrategyTrigger[];
}

const ShadowModePanel: React.FC<Props> = ({ strategies, triggers }) => {
  const [shadow, setShadow] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  });
  const [stats, setStats] = useState<Record<string, ShadowStats>>({});

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(shadow)); } catch { /* noop */ }
  }, [shadow]);

  useEffect(() => {
    setStats(prev => {
      const next = { ...prev };
      for (const t of triggers) {
        if (!shadow[t.strategy]) continue;
        const s = next[t.strategy] || { signals: 0, hypoPnL: 0, lastTs: 0, pnlSeries: [], signalSeries: [] };
        if (t.ts > s.lastTs) {
          s.signals += 1;
          s.hypoPnL += (t.confidence - 0.5) * 20;
          s.lastTs = t.ts;
          s.pnlSeries = [...s.pnlSeries, s.hypoPnL].slice(-40);
          s.signalSeries = [...s.signalSeries, s.signals].slice(-40);
          next[t.strategy] = { ...s };
        }
      }
      return next;
    });
  }, [triggers, shadow]);

  const toggle = (name: string) => setShadow(s => ({ ...s, [name]: !s[name] }));
  const clearOne = (name: string) => setStats(s => { const n = { ...s }; delete n[name]; return n; });
  const clearAll = () => setStats({});

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <EyeOff className="h-4 w-4 text-warning" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Shadow (Paper) Mode</h2>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={clearAll} aria-label="Reset all shadow stats">
          <RotateCcw className="h-3 w-3 mr-1" /> Reset session
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Toggle a strategy to shadow-only: signals + hypothetical P&L are logged, but no capital is risked.
      </p>
      {strategies.length === 0 ? (
        <p className="text-xs text-muted-foreground">Start the bot to configure shadow mode.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {strategies.map(s => {
            const on = !!shadow[s.name];
            const st = stats[s.name];
            return (
              <li key={s.name} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {on ? <EyeOff className="h-3.5 w-3.5 text-warning shrink-0" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-xs font-display capitalize truncate">{s.name.replace(/_/g, ' ')}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {st ? `${st.signals} signals · hypo P&L ${st.hypoPnL >= 0 ? '+' : ''}$${st.hypoPnL.toFixed(2)}` : 'No shadow signals yet'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={on} onCheckedChange={() => toggle(s.name)} aria-label={`Shadow mode for ${s.name}`} />
                    {st && (
                      <button
                        onClick={() => clearOne(s.name)}
                        className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                        aria-label={`Clear ${s.name} shadow stats`}
                      >
                        clear
                      </button>
                    )}
                  </div>
                </div>
                {st && st.pnlSeries.length > 1 && (
                  <div className="mt-1.5 grid grid-cols-2 gap-2 pl-6">
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Hypo P&L</div>
                      <Sparkline
                        data={st.pnlSeries}
                        width={140}
                        height={26}
                        stroke={st.hypoPnL >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                        fill={st.hypoPnL >= 0 ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--destructive) / 0.15)'}
                      />
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Signals</div>
                      <Sparkline data={st.signalSeries} width={140} height={26} stroke="hsl(var(--accent))" fill="hsl(var(--accent) / 0.15)" />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ShadowModePanel;
