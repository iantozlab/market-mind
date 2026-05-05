import React from 'react';
import type { BotMetrics } from '@/lib/neural-bot-engine';
import { Shield, AlertTriangle, TrendingDown, Target } from 'lucide-react';

interface Props {
  metrics: BotMetrics;
  initialCapital: number;
  maxDrawdownLimit: number; // 0..1
  dailyLossLimit: number;   // dollars
  isRunning: boolean;
  onEmergencyStop?: () => void;
}

const RiskDashboardPanel: React.FC<Props> = ({
  metrics, initialCapital, maxDrawdownLimit, dailyLossLimit, isRunning, onEmergencyStop,
}) => {
  const ddPct = metrics.maxDrawdown * 100;
  const ddPctOfLimit = Math.min(100, (metrics.maxDrawdown / maxDrawdownLimit) * 100);
  const dailyLossPct = Math.min(100, (Math.max(0, -metrics.dailyPnL) / dailyLossLimit) * 100);
  const exposurePct = Math.min(100, (metrics.activePositions / 8) * 100);

  let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (ddPctOfLimit > 80 || dailyLossPct > 80) level = 'critical';
  else if (ddPctOfLimit > 60 || dailyLossPct > 60) level = 'high';
  else if (ddPctOfLimit > 30 || dailyLossPct > 30) level = 'medium';

  const levelColor =
    level === 'critical' ? 'text-destructive border-destructive/40 bg-destructive/10' :
    level === 'high' ? 'text-warning border-warning/40 bg-warning/10' :
    level === 'medium' ? 'text-accent border-accent/40 bg-accent/10' :
    'text-primary border-primary/40 bg-primary/10';

  const Bar = ({ value, danger }: { value: number; danger?: boolean }) => (
    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${danger ? 'bg-destructive' : value > 60 ? 'bg-warning' : 'bg-primary'}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">Risk Management</h2>
        </div>
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wider ${levelColor}`}>
          {level}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Drawdown</span>
            <span className="font-mono text-foreground">{ddPct.toFixed(2)}%</span>
          </div>
          <Bar value={ddPctOfLimit} danger={ddPctOfLimit > 80} />
          <p className="text-[10px] text-muted-foreground">Limit {(maxDrawdownLimit * 100).toFixed(0)}% · Buffer {((maxDrawdownLimit - metrics.maxDrawdown) * 100).toFixed(1)}%</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Daily Loss</span>
            <span className="font-mono text-foreground">${Math.max(0, -metrics.dailyPnL).toFixed(2)}</span>
          </div>
          <Bar value={dailyLossPct} danger={dailyLossPct > 80} />
          <p className="text-[10px] text-muted-foreground">Limit ${dailyLossLimit.toFixed(0)}/day</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1"><Target className="h-3 w-3" /> Positions</span>
            <span className="font-mono text-foreground">{metrics.activePositions}/8</span>
          </div>
          <Bar value={exposurePct} />
          <p className="text-[10px] text-muted-foreground">Capital ${initialCapital.toLocaleString()} · Sharpe {metrics.sharpeRatio.toFixed(2)}</p>
        </div>
      </div>

      {isRunning && level === 'critical' && (
        <button
          onClick={onEmergencyStop}
          className="mt-3 w-full rounded border border-destructive/40 bg-destructive/10 text-destructive font-display text-xs uppercase tracking-widest py-1.5 hover:bg-destructive/20"
        >
          ■ Emergency Stop
        </button>
      )}
    </div>
  );
};

export default RiskDashboardPanel;
