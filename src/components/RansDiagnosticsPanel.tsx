import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { downloadCSV } from '@/lib/exporters';
import { toast } from 'sonner';
import type { RansDiagnostics } from '@/lib/neural-bot-engine';

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

const RansDiagnosticsPanel: React.FC<Props> = ({ dx }) => {
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

  const statusTone = dx.integrationOk && !dx.killSwitch
    ? 'text-primary border-primary/40 bg-primary/5'
    : dx.killSwitch
    ? 'text-destructive border-destructive/40 bg-destructive/5'
    : 'text-warning border-warning/40 bg-warning/5';
  const statusText = !dx.integrationOk ? 'OFFLINE' : dx.killSwitch ? 'KILL-SWITCH' : 'HEALTHY';

  const latencyTone = dx.avgLatencyMs > 50 ? 'text-destructive' : dx.avgLatencyMs > 20 ? 'text-warning' : 'text-primary';
  const dropoutTone = dx.dropoutRate > 0.5 ? 'text-destructive' : dx.dropoutRate > 0.25 ? 'text-warning' : 'text-foreground';
  const errorsTone = dx.errors > 0 ? 'text-destructive' : 'text-foreground';

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

      {dx.lastError && (
        <div className="text-[11px] font-mono text-destructive border border-destructive/30 bg-destructive/5 rounded px-2 py-1.5">
          Last error{dx.lastErrorTs ? ` (${new Date(dx.lastErrorTs).toLocaleTimeString()})` : ''}: {dx.lastError}
        </div>
      )}
    </div>
  );
};

export default RansDiagnosticsPanel;
