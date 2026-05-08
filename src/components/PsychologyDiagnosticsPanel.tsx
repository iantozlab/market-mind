import React from 'react';
import { Activity } from 'lucide-react';
import type { SignalRoute } from '@/lib/neural-bot-engine';

interface Props {
  routes: SignalRoute[];
}

const fmtAgo = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

const PsychologyDiagnosticsPanel: React.FC<Props> = ({ routes }) => {
  const sorted = [...routes].sort((a, b) => b.lastSeen - a.lastSeen);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
          Psychology Signal Diagnostics
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono ml-1">({routes.length} routes)</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">
        Live mapping verification — each row is a signal type emitted by the engine and the strategy-health key it updates.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="text-left font-display py-2">Signal Type</th>
              <th className="text-left font-display py-2">→ Health Key</th>
              <th className="text-right font-display py-2">Count</th>
              <th className="text-right font-display py-2">Avg Conf</th>
              <th className="text-right font-display py-2">Last</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">
                Start the bot — diagnostics populate as signals route.
              </td></tr>
            )}
            {sorted.map(r => {
              const ok = r.signalType === r.healthKey || (r.signalType === 'temporal_entry' && r.healthKey === 'temporal_decay');
              return (
                <tr key={r.signalType} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 font-mono text-foreground">{r.signalType}</td>
                  <td className="py-1.5 font-mono">
                    <span className={ok ? 'text-primary' : 'text-warning'}>{r.healthKey}</span>
                    {r.signalType !== r.healthKey && (
                      <span className="ml-2 text-[9px] text-muted-foreground">(remapped)</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">{r.count}</td>
                  <td className="py-1.5 text-right font-mono text-accent">{(r.avgConfidence * 100).toFixed(0)}%</td>
                  <td className="py-1.5 text-right font-mono text-[10px] text-muted-foreground">{fmtAgo(r.lastSeen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PsychologyDiagnosticsPanel;
