import React from 'react';
import { Layers, Brain, Zap } from 'lucide-react';
import type { ArbitrageSignal } from '@/lib/multi-market-arbitrage';
import type { SwarmPrediction, LatencyArbEvent } from '@/lib/polyswarm-integrator';

interface Props {
  signals: ArbitrageSignal[];
  executed: ArbitrageSignal[];
  realized: number;
  swarmSignals: SwarmPrediction[];
  swarmEvents: LatencyArbEvent[];
  agentCount: number;
}

const TYPE_COLOR: Record<string, string> = {
  mutually_exclusive: 'text-primary',
  dependent: 'text-info',
  combinatorial: 'text-warning',
};

const ArbSwarmPanel: React.FC<Props> = ({ signals, executed, realized, swarmSignals, swarmEvents, agentCount }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Live Arb Ops</p>
        <p className="font-mono text-lg text-primary">{signals.length}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Realized Arb</p>
        <p className="font-mono text-lg text-primary">${realized.toFixed(2)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Swarm Agents</p>
        <p className="font-mono text-lg text-info">{agentCount}</p>
      </div>
    </div>

    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
        <Layers className="h-4 w-4 text-primary" /> Multi-Market Arbitrage Signals
      </h3>
      {signals.length === 0 ? (
        <p className="text-xs text-muted-foreground">No guaranteed-profit structures detected this tick.</p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {signals.slice(0, 25).map(s => (
            <li key={s.id} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
              <span className={`uppercase w-32 shrink-0 ${TYPE_COLOR[s.type] ?? ''}`}>{s.type.replace(/_/g, ' ')}</span>
              <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
              <span className="text-muted-foreground">{s.legs.length} legs</span>
              <span className="text-primary">+${s.guaranteedProfit.toFixed(3)}</span>
              <span className="text-muted-foreground">{(s.confidence * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
        <Zap className="h-4 w-4 text-warning" /> Executed Arbitrage
      </h3>
      {executed.length === 0 ? (
        <p className="text-xs text-muted-foreground">No arbitrage executed yet.</p>
      ) : (
        <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
          {executed.slice(0, 20).map(s => (
            <li key={`${s.id}-${s.ts}`} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
              <span className="text-muted-foreground w-16 shrink-0">{new Date(s.ts).toLocaleTimeString()}</span>
              <span className="flex-1 truncate">{s.label}</span>
              <span className="text-primary">+${s.guaranteedProfit.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
        <Brain className="h-4 w-4 text-info" /> PolySwarm Inefficiencies (KL/JS divergence)
      </h3>
      {swarmSignals.length === 0 ? (
        <p className="text-xs text-muted-foreground">Swarm consensus matches market pricing.</p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {swarmSignals.map(p => (
            <li key={p.marketId} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
              <span className="flex-1 truncate">{p.slug ?? p.marketId}</span>
              <span className="text-muted-foreground">p {p.swarmProbability.toFixed(3)}</span>
              <span className="text-info">div {p.divergence.toFixed(4)}</span>
              <span className="text-muted-foreground">{(p.swarmConfidence * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      )}
      {swarmEvents.length > 0 && (
        <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
          {swarmEvents.slice(0, 10).map(e => (
            <li key={`${e.marketId}-${e.ts}`} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
              <span className="w-16 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className={e.direction === 'BUY' ? 'text-primary' : 'text-warning'}>{e.direction}</span>
              <span className="flex-1 truncate">{e.slug ?? e.marketId}</span>
              <span>edge {e.edge.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);

export default ArbSwarmPanel;
