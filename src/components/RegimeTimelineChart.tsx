import React from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceDot } from 'recharts';
import type { RansHistoryEntry } from '@/lib/neural-bot-engine';

interface Props { history: RansHistoryEntry[]; }

const REGIME_LANE: Record<string, number> = {
  low_volatility: 1, mean_reverting: 2, trending: 3, high_volatility: 4, event_driven: 5,
};
const REGIME_COLOR: Record<string, string> = {
  low_volatility: 'hsl(var(--accent))',
  mean_reverting: 'hsl(var(--primary))',
  trending: 'hsl(var(--info))',
  high_volatility: 'hsl(var(--destructive))',
  event_driven: 'hsl(var(--warning))',
};

const RegimeTimelineChart: React.FC<Props> = ({ history }) => {
  if (history.length < 2) {
    return <p className="text-xs text-muted-foreground">Awaiting RANS history… let the bot run for a few ticks.</p>;
  }
  const data = history.slice(-120).map(h => ({
    t: new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ts: h.ts,
    regimeLane: REGIME_LANE[h.regime] ?? 0,
    regime: h.regime,
    directional: h.directional * 100,
    arbitrage: h.arbitrage * 100,
    temporal: h.temporal * 100,
    changed: h.regimeChanged,
  }));
  const changes = data.filter(d => d.changed);

  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-background/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Regime Lane · last {data.length} ticks</span>
          <span className="text-[10px] font-mono text-muted-foreground">{changes.length} change(s)</span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={data}>
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(v) => ({ 1: 'LowVol', 2: 'MeanRev', 3: 'Trend', 4: 'HighVol', 5: 'Event' } as any)[v] ?? ''} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={60} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11, color: 'hsl(var(--foreground))' }} formatter={(_v, _n, p: any) => [p.payload.regime.replace('_', ' '), 'Regime']} />
            <Line type="stepAfter" dataKey="regimeLane" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            {changes.map((c, i) => (
              <ReferenceDot key={i} x={c.t} y={c.regimeLane} r={4} fill={REGIME_COLOR[c.regime]} stroke="hsl(var(--background))" strokeWidth={1.5} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded border border-border bg-background/40 p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Applied Weights · α directional / β arb / γ temporal (%)</div>
        <ResponsiveContainer width="100%" height={150}>
          <ComposedChart data={data} stackOffset="expand">
            <defs>
              <linearGradient id="wDir" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--info))" stopOpacity={0.7}/><stop offset="95%" stopColor="hsl(var(--info))" stopOpacity={0.1}/></linearGradient>
              <linearGradient id="wArb" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.7}/><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/></linearGradient>
              <linearGradient id="wTmp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.7}/><stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0.1}/></linearGradient>
            </defs>
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11, color: 'hsl(var(--foreground))' }} />
            <Area type="monotone" dataKey="directional" stackId="1" stroke="hsl(var(--info))" fill="url(#wDir)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="arbitrage" stackId="1" stroke="hsl(var(--primary))" fill="url(#wArb)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="temporal" stackId="1" stroke="hsl(var(--accent))" fill="url(#wTmp)" strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex gap-3 mt-1 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-info rounded-sm" />directional</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-primary rounded-sm" />arbitrage</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-accent rounded-sm" />temporal</span>
        </div>
      </div>
    </div>
  );
};

export default RegimeTimelineChart;
