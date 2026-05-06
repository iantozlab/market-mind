import React from 'react';
import { Brain, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { MLInsights } from '@/lib/neural-bot-engine';

const signalStyle: Record<MLInsights['signal'], { color: string; icon: React.ReactNode }> = {
  BULLISH: { color: 'text-primary border-primary/40 bg-primary/10', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  NEUTRAL: { color: 'text-accent border-accent/40 bg-accent/10', icon: <Minus className="h-3.5 w-3.5" /> },
  BEARISH: { color: 'text-destructive border-destructive/40 bg-destructive/10', icon: <TrendingDown className="h-3.5 w-3.5" /> },
};

const MLInsightsPanel: React.FC<{ insights: MLInsights | null }> = ({ insights }) => {
  if (!insights) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">ML Insights</h2>
        </div>
        <p className="text-xs text-muted-foreground">Start the bot to begin generating neural insights.</p>
      </div>
    );
  }

  const sig = signalStyle[insights.signal];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">ML Insights</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-display text-[10px] uppercase tracking-widest ${sig.color}`}>
          {sig.icon} {insights.signal}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Confidence Drivers</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground font-display">Aggregate Confidence</span>
              <span className="font-mono text-primary">{(insights.confidence * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, insights.confidence * 100)}%` }} />
            </div>
            <div className="space-y-1.5 mt-2">
              {insights.drivers.map(d => (
                <div key={d.label}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{d.label} <span className="text-[9px]">w={(d.weight * 100).toFixed(0)}%</span></span>
                    <span className="font-mono text-foreground">{(d.value * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, d.value * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Per-Strategy Δ Win Rate</div>
          <div className="max-h-64 overflow-y-auto pr-1">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-display py-1.5">Strategy</th>
                  <th className="text-right font-display py-1.5">WR</th>
                  <th className="text-right font-display py-1.5">Δ</th>
                  <th className="text-right font-display py-1.5">Trades</th>
                </tr>
              </thead>
              <tbody>
                {insights.perStrategy.map(s => {
                  const dColor = s.delta > 0.001 ? 'text-primary' : s.delta < -0.001 ? 'text-destructive' : 'text-muted-foreground';
                  const arrow = s.delta > 0.001 ? '▲' : s.delta < -0.001 ? '▼' : '—';
                  return (
                    <tr key={s.name} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 font-display text-foreground capitalize">{s.name.replace(/_/g, ' ')}</td>
                      <td className="py-1.5 text-right font-mono">{(s.winRate * 100).toFixed(1)}%</td>
                      <td className={`py-1.5 text-right font-mono ${dColor}`}>{arrow} {(Math.abs(s.delta) * 100).toFixed(2)}%</td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground">{s.trades}</td>
                    </tr>
                  );
                })}
                {insights.perStrategy.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No strategy data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MLInsightsPanel;
