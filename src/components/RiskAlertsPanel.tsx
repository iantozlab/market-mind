import React from 'react';
import { ShieldAlert, Snowflake, AlertTriangle, TrendingDown, Target, CheckCircle2 } from 'lucide-react';
import type { BotMetrics, CooldownStatus } from '@/lib/neural-bot-engine';

interface Props {
  metrics: BotMetrics;
  maxDrawdownLimit: number;
  dailyLossLimit: number;
  maxPositions: number;
  cooldown: CooldownStatus | null;
  isRunning: boolean;
  onEmergencyStop?: () => void;
}

interface RiskLine {
  key: string;
  icon: React.ReactNode;
  label: string;
  detail: string;
  pct: number;     // % of limit (0..100+)
  level: 'ok' | 'warn' | 'critical';
}

const levelClasses = (l: RiskLine['level']) =>
  l === 'critical' ? 'border-destructive/40 bg-destructive/10 text-destructive' :
  l === 'warn'     ? 'border-warning/40 bg-warning/10 text-warning' :
                     'border-primary/30 bg-primary/5 text-primary';

const RiskAlertsPanel: React.FC<Props> = ({
  metrics, maxDrawdownLimit, dailyLossLimit, maxPositions, cooldown, isRunning, onEmergencyStop,
}) => {
  const ddPct = Math.min(200, (metrics.maxDrawdown / maxDrawdownLimit) * 100);
  const dlPct = Math.min(200, (Math.max(0, -metrics.dailyPnL) / dailyLossLimit) * 100);
  const expPct = Math.min(200, (metrics.activePositions / maxPositions) * 100);

  const tier = (p: number): RiskLine['level'] => p >= 100 ? 'critical' : p >= 75 ? 'warn' : 'ok';

  const lines: RiskLine[] = [
    {
      key: 'dd',
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      label: 'Max Drawdown',
      detail: `${(metrics.maxDrawdown * 100).toFixed(2)}% of ${(maxDrawdownLimit * 100).toFixed(0)}% cap`,
      pct: ddPct, level: tier(ddPct),
    },
    {
      key: 'dl',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: 'Daily Loss',
      detail: `$${Math.max(0, -metrics.dailyPnL).toFixed(2)} of $${dailyLossLimit.toFixed(0)} cap`,
      pct: dlPct, level: tier(dlPct),
    },
    {
      key: 'exp',
      icon: <Target className="h-3.5 w-3.5" />,
      label: 'Position Exposure',
      detail: `${metrics.activePositions}/${maxPositions} concurrent positions`,
      pct: expPct, level: tier(expPct),
    },
  ];

  const breaches = lines.filter(l => l.level !== 'ok');
  const inCooldown = !!cooldown?.active;

  return (
    <div className={`rounded-lg border bg-card p-4 ${inCooldown ? 'border-warning/40' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">Risk Threshold Alerts</h2>
        </div>
        {inCooldown ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-display uppercase tracking-widest animate-pulse">
            <Snowflake className="h-3 w-3" />
            Cooldown · {cooldown!.remainingSec}s · {cooldown!.reason}
          </span>
        ) : breaches.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-primary/30 bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-display uppercase tracking-widest">
            <CheckCircle2 className="h-3 w-3" /> All systems nominal
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 text-warning px-2 py-0.5 text-[10px] font-display uppercase tracking-widest">
            {breaches.length} threshold breach{breaches.length > 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {lines.map(l => (
          <div key={l.key} className={`rounded border px-3 py-2 flex items-center gap-3 ${levelClasses(l.level)}`}>
            <div className="shrink-0">{l.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs">
                <span className="font-display tracking-wide">{l.label}</span>
                <span className="font-mono text-[10px] opacity-80">{l.pct.toFixed(0)}%</span>
              </div>
              <div className="text-[10px] opacity-80 font-mono truncate">{l.detail}</div>
              <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden mt-1">
                <div
                  className={`h-full ${l.level === 'critical' ? 'bg-destructive' : l.level === 'warn' ? 'bg-warning' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, l.pct)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {isRunning && (breaches.some(b => b.level === 'critical') || inCooldown) && (
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

export default RiskAlertsPanel;
