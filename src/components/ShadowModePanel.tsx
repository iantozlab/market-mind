import React, { useEffect, useState } from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';

const KEY = 'shadow_mode_strategies_v1';

interface ShadowStats { signals: number; hypoPnL: number; lastTs: number }

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
        const s = next[t.strategy] || { signals: 0, hypoPnL: 0, lastTs: 0 };
        if (t.ts > s.lastTs) {
          s.signals += 1;
          // hypothetical P&L: confidence-scaled signed random walk
          s.hypoPnL += (t.confidence - 0.5) * 20;
          s.lastTs = t.ts;
          next[t.strategy] = { ...s };
        }
      }
      return next;
    });
  }, [triggers, shadow]);

  const toggle = (name: string) => setShadow(s => ({ ...s, [name]: !s[name] }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <EyeOff className="h-4 w-4 text-warning" />
        <h2 className="font-display text-sm font-semibold tracking-wide">Shadow (Paper) Mode</h2>
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
              <li key={s.name} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  {on ? <EyeOff className="h-3.5 w-3.5 text-warning" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                  <div>
                    <div className="text-xs font-display capitalize">{s.name.replace(/_/g, ' ')}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {st ? `${st.signals} signals · hypo P&L ${st.hypoPnL >= 0 ? '+' : ''}$${st.hypoPnL.toFixed(2)}` : 'No shadow signals yet'}
                    </div>
                  </div>
                </div>
                <Switch checked={on} onCheckedChange={() => toggle(s.name)} aria-label={`Shadow mode for ${s.name}`} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ShadowModePanel;
