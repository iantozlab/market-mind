import React from 'react';

export interface PsychologyHealthRow {
  name: string;
  winRate: number;
  trades: number;
  isHealthy: boolean;
}

interface Props {
  rows: PsychologyHealthRow[];
  isRunning: boolean;
}

const labelMap: Record<string, string> = {
  bot_exhaustion: 'Bot Exhaustion',
  liquidity_provision: 'Liquidity Provision',
  pre_event: 'Pre-Event',
  whale_inactivity: 'Whale Inactivity',
  anchor_reversion: 'Anchor Reversion',
  zk_exploit: 'ZK Exploit',
  convergence_fade: 'Convergence Fade',
  governance_attack: 'Governance Attack',
  temporal_decay: 'Temporal Decay',
  temporal_entry: 'Temporal Entry',
};

const PsychologyHealthPanel: React.FC<Props> = ({ rows, isRunning }) => {
  const sorted = [...rows].sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-semibold text-foreground tracking-wide">
          Market Psychology · Strategy Health
        </h2>
        <span className={`flex items-center gap-1.5 text-[10px] font-display uppercase tracking-widest ${isRunning ? 'text-primary' : 'text-muted-foreground'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
          {isRunning ? 'Live' : 'Idle'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="text-left font-display font-medium py-2">Strategy</th>
              <th className="text-right font-display font-medium py-2">Win Rate</th>
              <th className="text-right font-display font-medium py-2">Trades</th>
              <th className="text-right font-display font-medium py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const wr = r.winRate * 100;
              const wrColor = wr >= 55 ? 'text-primary' : wr >= 45 ? 'text-accent' : 'text-destructive';
              return (
                <tr key={r.name} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                  <td className="py-2 font-display text-foreground">{labelMap[r.name] ?? r.name}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${wr >= 55 ? 'bg-primary' : wr >= 45 ? 'bg-accent' : 'bg-destructive'}`}
                          style={{ width: `${Math.min(100, Math.max(0, wr))}%` }}
                        />
                      </div>
                      <span className={`font-mono ${wrColor}`}>{wr.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono text-muted-foreground">{r.trades}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider ${
                        r.isHealthy
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-destructive/30 bg-destructive/10 text-destructive'
                      }`}
                    >
                      <span className={`h-1 w-1 rounded-full ${r.isHealthy ? 'bg-primary' : 'bg-destructive'}`} />
                      {r.isHealthy ? 'Healthy' : 'Deprecated'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">
                  No psychology data yet — start the bot to begin tracking.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PsychologyHealthPanel;
