import React from 'react';
import type { RANSPlan } from '@/lib/rans-engine';
import { RANS_PARAMS } from '@/lib/rans-engine';

interface Props {
  plan: RANSPlan | null;
  capital: number;
  realized: number;
}

const regimeTone: Record<string, string> = {
  trending: 'text-info border-info/40 bg-info/5',
  mean_reverting: 'text-primary border-primary/40 bg-primary/5',
  high_volatility: 'text-destructive border-destructive/40 bg-destructive/5',
  low_volatility: 'text-accent border-accent/40 bg-accent/5',
  event_driven: 'text-warning border-warning/40 bg-warning/5',
};

const phaseTone: Record<string, string> = {
  entry: 'text-primary',
  hold: 'text-info',
  exit: 'text-accent',
  danger: 'text-destructive',
  idle: 'text-muted-foreground',
};

const RansPanel: React.FC<Props> = ({ plan, capital, realized }) => {
  if (!plan) {
    return (
      <p className="text-xs text-muted-foreground">
        Start the bot to activate the RANS execution engine.
      </p>
    );
  }

  const tone = regimeTone[plan.regime] ?? 'text-foreground border-border';
  const w = plan.weights;

  return (
    <div className="space-y-4">
      {/* Header / regime */}
      <div className={`rounded-lg border px-4 py-3 ${tone}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest opacity-70">Current Regime</div>
            <div className="font-display text-xl font-bold tracking-wide">
              {plan.regime.replace('_', ' ').toUpperCase()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest opacity-70">Confidence</div>
            <div className="font-mono text-lg">{(plan.regimeConfidence * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* Weights */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Dynamic Strategy Weights · α / β / γ
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Directional', value: w.directional, tone: 'bg-info' },
            { label: 'Arbitrage', value: w.arbitrage, tone: 'bg-primary' },
            { label: 'Temporal', value: w.temporal, tone: 'bg-accent' },
          ].map(s => (
            <div key={s.label} className="rounded border border-border bg-background/40 p-2">
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
              <div className="font-display text-2xl text-foreground">{Math.round(s.value * 100)}%</div>
              <div className="w-full h-1.5 bg-muted/40 rounded overflow-hidden mt-1">
                <div className={`h-full ${s.tone}`} style={{ width: `${s.value * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Capital / returns */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">RANS Capital</div>
          <div className="font-mono text-sm text-foreground">${capital.toFixed(0)}</div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Realized Arb</div>
          <div className={`font-mono text-sm ${realized >= 0 ? 'text-primary' : 'text-destructive'}`}>
            ${realized.toFixed(2)}
          </div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Exp Daily Return</div>
          <div className="font-mono text-sm text-accent">{(plan.expectedDailyReturn * 100).toFixed(2)}%</div>
        </div>
      </div>

      {/* Arbitrage signals */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Structural Arbitrage · {plan.arbitrageSignals.length} live
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto terminal-scrollbar">
          {plan.arbitrageSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No arbitrage opportunities this tick.</p>
          ) : plan.arbitrageSignals.map((a, i) => (
            <div key={i} className="rounded border border-border bg-background/40 px-2 py-1.5 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display text-foreground truncate">
                  {a.type} · <span className="text-muted-foreground">{a.marketSlug ?? a.marketId.slice(0, 10)}</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {a.action} · req ${a.requiredCapital.toFixed(0)} · conf {(a.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-primary font-mono">+{(a.profitGuaranteed * 100).toFixed(2)}%</div>
                <div className="text-[10px] font-mono text-muted-foreground">est ${a.expectedReturn.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Temporal windows */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          30-Day Rule · Temporal Windows
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto terminal-scrollbar">
          {plan.temporalWindows.map(w => (
            <div key={w.marketId} className="rounded border border-border bg-background/40 px-2 py-1.5 text-[11px] flex items-center justify-between">
              <span className="font-mono text-muted-foreground truncate">{w.marketId.slice(0, 10)}</span>
              <span className={`font-display uppercase tracking-wide ${phaseTone[w.phase]}`}>
                {w.phase} · {w.daysToExpiry.toFixed(1)}d
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Formula */}
      <div className="rounded border border-border bg-background/40 p-3 text-[11px] font-mono text-muted-foreground">
        <div className="mb-1 text-foreground">RANS Edge =</div>
        <div>α({Math.round(w.directional * 100)}%)·Directional + β({Math.round(w.arbitrage * 100)}%)·Arb + γ({Math.round(w.temporal * 100)}%)·Temporal</div>
        <div className="mt-1 text-[10px]">
          Targets: WR ≥ {(RANS_PARAMS.TARGET_WIN_RATE * 100).toFixed(0)}% · Sharpe ≥ {RANS_PARAMS.SHARPE_TARGET} · Max DD ≤ {(RANS_PARAMS.MAX_DRAWDOWN * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
};

export default RansPanel;
