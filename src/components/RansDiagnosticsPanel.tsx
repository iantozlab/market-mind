import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, AlertOctagon, ShieldAlert, Clock, RefreshCw } from 'lucide-react';
import { downloadCSV } from '@/lib/exporters';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { RansDiagnostics } from '@/lib/neural-bot-engine';
import { queryRansDiagEvents, type RansDiagEvent, type RansDiagEventType } from '@/lib/rans-diag-events';

interface Props {
  dx: RansDiagnostics | null;
}

const fmtMs = (n: number) => `${n.toFixed(1)}ms`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDur = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="rounded border border-border bg-background/40 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={`font-mono text-sm ${tone ?? 'text-foreground'}`}>{value}</div>
  </div>
);

const EVENT_TYPES: RansDiagEventType[] = ['signal_dropout', 'guardrail_clamp', 'kill_switch', 'kill_switch_resume', 'regime_change'];

const RansDiagnosticsPanel: React.FC<Props> = ({ dx }) => {
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [typeFilter, setTypeFilter] = useState<RansDiagEventType | 'all'>('all');
  const [events, setEvents] = useState<RansDiagEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const loadEvents = async () => {
    setLoadingEvents(true);
    const fromIso = new Date(Date.now() - rangeHours * 3_600_000).toISOString();
    const res = await queryRansDiagEvents({
      fromIso,
      types: typeFilter === 'all' ? undefined : [typeFilter],
      limit: 250,
    });
    setEvents(res);
    setLoadingEvents(false);
  };
  useEffect(() => { loadEvents(); /* eslint-disable-next-line */ }, [rangeHours, typeFilter]);

  if (!dx) {
    return (
      <div className="rounded border border-border bg-background/40 p-3 text-xs text-muted-foreground">
        Start the bot to populate RANS diagnostics.
      </div>
    );
  }

  const exportCsv = () => {
    if (dx.tickCount === 0) { toast.error('No diagnostics ticks yet'); return; }
    downloadCSV(`rans-diagnostics-${Date.now()}.csv`, [{
      timestamp: new Date().toISOString(),
      integration_ok: dx.integrationOk ? 'YES' : 'NO',
      kill_switch: dx.killSwitch ? 'ENGAGED' : 'OFF',
      kill_switch_reason: dx.killSwitchReason,
      kill_switch_at: dx.killSwitchAt ? new Date(dx.killSwitchAt).toISOString() : '',
      uptime_ms: dx.uptimeMs,
      tick_count: dx.tickCount,
      last_latency_ms: dx.lastLatencyMs.toFixed(2),
      avg_latency_ms: dx.avgLatencyMs.toFixed(2),
      max_latency_ms: dx.maxLatencyMs.toFixed(2),
      signal_dropouts: dx.signalDropouts,
      dropout_rate: dx.dropoutRate.toFixed(4),
      arb_activations: dx.arbActivations,
      temporal_activations: dx.temporalActivations,
      activation_rate: dx.activationRate.toFixed(4),
      regime_changes: dx.regimeChanges,
      errors: dx.errors,
      last_error: dx.lastError,
      last_error_ts: dx.lastErrorTs ? new Date(dx.lastErrorTs).toISOString() : '',
    }]);
    toast.success('Diagnostics exported');
  };

  const exportSeriesCsv = () => {
    if (dx.latencyHistory.length === 0) { toast.error('No samples yet'); return; }
    const rows = dx.latencyHistory.map((p, i) => ({
      tick: p.tick,
      timestamp: new Date(p.ts).toISOString(),
      latency_ms: p.latencyMs.toFixed(3),
      activation_rate: (dx.activationHistory[i]?.rate ?? 0).toFixed(4),
    }));
    downloadCSV(`rans-diag-series-${Date.now()}.csv`, rows);
    toast.success('Series exported');
  };

  const exportEventsCsv = () => {
    if (events.length === 0) { toast.error('No events in range'); return; }
    downloadCSV(`rans-diag-events-${Date.now()}.csv`, events.map(e => ({
      created_at: e.created_at ?? '',
      event_type: e.event_type,
      severity: e.severity,
      detail: JSON.stringify(e.detail),
    })));
    toast.success('Events exported');
  };

  const statusTone = dx.integrationOk && !dx.killSwitch
    ? 'text-primary border-primary/40 bg-primary/5'
    : dx.killSwitch
    ? 'text-destructive border-destructive/40 bg-destructive/5'
    : 'text-warning border-warning/40 bg-warning/5';
  const statusText = !dx.integrationOk ? 'OFFLINE' : dx.killSwitch ? 'KILL-SWITCH' : 'HEALTHY';

  const latencyTone = dx.avgLatencyMs > 50 ? 'text-destructive' : dx.avgLatencyMs > 20 ? 'text-warning' : 'text-primary';
  const dropoutTone = dx.dropoutRate > 0.5 ? 'text-destructive' : dx.dropoutRate > 0.25 ? 'text-warning' : 'text-foreground';
  const errorsTone = dx.errors > 0 ? 'text-destructive' : 'text-foreground';

  const latencyChart = useMemo(() =>
    dx.latencyHistory.map(p => ({ tick: p.tick, latency: Number(p.latencyMs.toFixed(2)) })),
  [dx.latencyHistory]);
  const actChart = useMemo(() =>
    dx.activationHistory.map(p => ({ tick: p.tick, rate: Number(p.rate.toFixed(3)) })),
  [dx.activationHistory]);

  return (
    <div className="rounded border border-border bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">RANS Diagnostics</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-display tracking-widest px-2 py-0.5 rounded border ${statusTone}`}>
            {statusText}
          </span>
          <Button size="sm" variant="outline" onClick={exportCsv} className="h-7 text-xs">
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Kill switch reason banner */}
      {dx.killSwitch && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-destructive font-display tracking-wide">
            <AlertOctagon className="h-3.5 w-3.5" /> Kill switch triggered by
          </div>
          <div className="font-mono text-foreground mt-0.5 break-all">{dx.killSwitchReason || '—'}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {dx.killSwitchAt ? new Date(dx.killSwitchAt).toLocaleString() : '—'}
          </div>
          {Object.keys(dx.killSwitchMetrics).length > 0 && (
            <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-1">
              {Object.entries(dx.killSwitchMetrics).map(([k, v]) => (
                <div key={k} className="rounded border border-destructive/30 bg-background/40 px-1.5 py-0.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className="font-mono text-[11px] text-foreground">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Uptime" value={fmtDur(dx.uptimeMs)} />
        <Stat label="Ticks" value={dx.tickCount} />
        <Stat label="Last Latency" value={fmtMs(dx.lastLatencyMs)} tone={latencyTone} />
        <Stat label="Avg Latency" value={fmtMs(dx.avgLatencyMs)} tone={latencyTone} />
        <Stat label="Max Latency" value={fmtMs(dx.maxLatencyMs)} />
        <Stat label="Activation Rate" value={dx.activationRate.toFixed(2) + '/tick'} />
        <Stat label="Signal Dropouts" value={`${dx.signalDropouts} (${fmtPct(dx.dropoutRate)})`} tone={dropoutTone} />
        <Stat label="Regime Changes" value={dx.regimeChanges} />
        <Stat label="Arb Activations" value={dx.arbActivations} />
        <Stat label="Temporal Activations" value={dx.temporalActivations} />
        <Stat label="Errors" value={dx.errors} tone={errorsTone} />
        <Stat label="Integration" value={dx.integrationOk ? 'WIRED' : 'MISSING'} tone={dx.integrationOk ? 'text-primary' : 'text-destructive'} />
      </div>

      {/* Live charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Tick Latency (ms)</div>
            <div className="text-[10px] font-mono text-muted-foreground">avg {dx.avgLatencyMs.toFixed(1)} · max {dx.maxLatencyMs.toFixed(1)}</div>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer>
              <LineChart data={latencyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="tick" hide />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                <ReferenceLine y={dx.avgLatencyMs} stroke="hsl(var(--primary))" strokeDasharray="2 2" />
                <ReferenceLine y={dx.maxLatencyMs} stroke="hsl(var(--destructive))" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="latency" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Activation Rate (per tick)</div>
            <div className="text-[10px] font-mono text-muted-foreground">now {dx.activationRate.toFixed(2)}</div>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer>
              <LineChart data={actChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="tick" hide />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                <ReferenceLine y={dx.activationRate} stroke="hsl(var(--primary))" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportSeriesCsv} className="h-7 text-xs">
          <Download className="h-3 w-3 mr-1" /> Export Series CSV
        </Button>
      </div>

      {/* Guardrail violation viewer */}
      <div className="rounded border border-border bg-background/40 p-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-warning" />
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Guardrail Violations · last {Math.min(dx.guardrailViolations.length, 20)} of {dx.guardrailViolations.length}
          </div>
        </div>
        {dx.guardrailViolations.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No guardrail violations recorded.</div>
        ) : (
          <div className="max-h-60 overflow-y-auto terminal-scrollbar space-y-1">
            {dx.guardrailViolations.slice(0, 20).map((v, i) => (
              <div key={i} className="rounded border border-border bg-background/60 px-2 py-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="font-display tracking-wide">
                    {v.source.toUpperCase()} {v.regime ? `· ${v.regime}` : ''} · tick {v.tick}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">{new Date(v.ts).toLocaleTimeString()}</div>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-0.5">
                  {v.details.map((d, j) => (
                    <div key={j} className={`font-mono ${d.clamped ? 'text-warning' : 'text-muted-foreground'}`}>
                      <span className="text-foreground">{d.field}</span>: {d.before.toFixed(4)} → {d.after.toFixed(4)}
                      {' '}<span className="text-muted-foreground">[bounds {d.bounds.min}…{Number.isFinite(d.bounds.max) ? d.bounds.max : '∞'}]</span>
                      {d.normalized && <span className="text-accent"> · normalized</span>}
                      {d.clamped && <span className="text-warning"> · CLAMPED</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Persisted events query */}
      <div className="rounded border border-border bg-background/40 p-2">
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Persisted Events · {events.length}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={rangeHours}
              onChange={(e) => setRangeHours(Number(e.target.value))}
              className="h-7 text-[11px] bg-background border border-border rounded px-1.5 font-mono"
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>72h</option>
              <option value={168}>7d</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RansDiagEventType | 'all')}
              className="h-7 text-[11px] bg-background border border-border rounded px-1.5 font-mono"
            >
              <option value="all">all types</option>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={loadEvents} disabled={loadingEvents} className="h-7 text-xs">
              <RefreshCw className={`h-3 w-3 mr-1 ${loadingEvents ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={exportEventsCsv} className="h-7 text-xs">
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        </div>
        {events.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No persisted events in this range.</div>
        ) : (
          <div className="max-h-60 overflow-y-auto terminal-scrollbar">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left px-1.5 py-1">Time</th>
                  <th className="text-left px-1.5 py-1">Type</th>
                  <th className="text-left px-1.5 py-1">Sev</th>
                  <th className="text-left px-1.5 py-1">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {events.map((e, i) => (
                  <tr key={i}>
                    <td className="px-1.5 py-1 font-mono text-muted-foreground whitespace-nowrap">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                    </td>
                    <td className="px-1.5 py-1 font-display tracking-wide">{e.event_type}</td>
                    <td className={`px-1.5 py-1 font-mono ${e.severity === 'critical' ? 'text-destructive' : e.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>
                      {e.severity}
                    </td>
                    <td className="px-1.5 py-1 font-mono text-[10px] truncate max-w-[420px]">
                      {JSON.stringify(e.detail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dx.lastError && (
        <div className="text-[11px] font-mono text-destructive border border-destructive/30 bg-destructive/5 rounded px-2 py-1.5">
          Last error{dx.lastErrorTs ? ` (${new Date(dx.lastErrorTs).toLocaleTimeString()})` : ''}: {dx.lastError}
        </div>
      )}
    </div>
  );
};

export default RansDiagnosticsPanel;
