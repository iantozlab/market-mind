import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Sparkline from './Sparkline';
import StrategyDetailDrawer from './StrategyDetailDrawer';
import { usePsychologySnapshots, type SnapshotPoint } from '@/hooks/usePsychologySnapshots';
import { downloadCSV, downloadPDF } from '@/lib/exporters';

export interface PsychologyHealthRow {
  name: string;
  winRate: number;
  trades: number;
  isHealthy: boolean;
  lastUpdate?: number;
}

interface RecentTrade { ts: number; won: boolean; pnl: number }

interface Props {
  rows: PsychologyHealthRow[];
  isRunning: boolean;
  /** Returns recent trades for a strategy name. */
  getRecentTrades?: (name: string) => RecentTrade[];
  /** Initial alert threshold (0..1). User-configurable in UI. */
  defaultThreshold?: number;
  onThresholdChange?: (t: number) => void;
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

const fmtAgo = (t?: number) => {
  if (!t) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

const PsychologyHealthPanel: React.FC<Props> = ({
  rows,
  isRunning,
  getRecentTrades,
  defaultThreshold = 0.45,
  onThresholdChange,
}) => {
  const [threshold, setThreshold] = useState(defaultThreshold);
  const [selected, setSelected] = useState<PsychologyHealthRow | null>(null);
  const { history, settings, setSettings, pruneNow } = usePsychologySnapshots(rows, isRunning);
  const alertedRef = useRef<Set<string>>(new Set());

  // Visual + toast alerts when a strategy crosses the threshold (deprecated)
  useEffect(() => {
    for (const r of rows) {
      const tooLow = r.trades > 20 && r.winRate < threshold;
      const key = `${r.name}:${tooLow ? 'low' : 'ok'}`;
      if (tooLow && !alertedRef.current.has(r.name)) {
        alertedRef.current.add(r.name);
        toast.error(`Strategy deprecated: ${labelMap[r.name] ?? r.name}`, {
          description: `Win rate ${(r.winRate * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold (${r.trades} trades)`,
        });
      } else if (!tooLow && alertedRef.current.has(r.name) && r.winRate >= threshold + 0.05) {
        alertedRef.current.delete(r.name);
        toast.success(`Recovered: ${labelMap[r.name] ?? r.name}`, {
          description: `Win rate ${(r.winRate * 100).toFixed(1)}%`,
        });
      }
    }
  }, [rows, threshold]);

  const sorted = [...rows].sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);

  const handleThreshold = (v: number) => {
    setThreshold(v);
    onThresholdChange?.(v);
  };

  const recent = selected && getRecentTrades ? getRecentTrades(selected.name) : [];
  const seriesFor = (name: string): SnapshotPoint[] => history[name] ?? [];

  const exportCSV = () => {
    const out: Record<string, unknown>[] = [];
    for (const [name, pts] of Object.entries(history)) {
      for (const p of pts) {
        out.push({
          strategy: name,
          timestamp: new Date(p.t).toISOString(),
          win_rate: p.winRate,
          trades: p.trades,
          is_healthy: p.isHealthy,
        });
      }
    }
    if (out.length === 0) { toast.info('No snapshots to export yet.'); return; }
    downloadCSV(`psychology_snapshots_${Date.now()}.csv`, out);
  };

  const exportPDF = () => {
    const rowsOut = sorted.map(r => [
      labelMap[r.name] ?? r.name,
      `${(r.winRate * 100).toFixed(1)}%`,
      r.trades,
      r.trades > 20 && r.winRate < threshold ? 'Deprecated' : 'Healthy',
    ]);
    if (rowsOut.length === 0) { toast.info('No strategy data to export.'); return; }
    downloadPDF(
      `psychology_health_${Date.now()}.pdf`,
      'Market Psychology · Strategy Health',
      ['Strategy', 'Win Rate', 'Trades', 'Status'],
      rowsOut,
      { Threshold: `${(threshold * 100).toFixed(0)}%`, Strategies: rowsOut.length },
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-display text-sm font-semibold text-foreground tracking-wide">
          Market Psychology · Strategy Health
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted-foreground">
            Alert &lt;
            <input
              type="number" min={10} max={90} step={1}
              value={Math.round(threshold * 100)}
              onChange={(e) => handleThreshold(Math.max(0.1, Math.min(0.9, Number(e.target.value) / 100)))}
              className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-foreground text-xs font-mono"
            />
            %
          </label>
          <label className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted-foreground">
            Poll
            <input
              type="number" min={5} max={300} step={5}
              value={Math.round(settings.intervalMs / 1000)}
              onChange={(e) => setSettings({ intervalMs: Math.max(5, Number(e.target.value)) * 1000 })}
              className="w-12 bg-background border border-border rounded px-1.5 py-0.5 text-foreground text-xs font-mono"
            />s
          </label>
          <label className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted-foreground">
            Retain
            <input
              type="number" min={1} max={720} step={1}
              value={settings.retentionHours}
              onChange={(e) => setSettings({ retentionHours: Math.max(1, Number(e.target.value)) })}
              className="w-14 bg-background border border-border rounded px-1.5 py-0.5 text-foreground text-xs font-mono"
            />h
          </label>
          <Button onClick={exportCSV} size="sm" variant="outline" className="h-7 text-[10px]">
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button onClick={exportPDF} size="sm" variant="outline" className="h-7 text-[10px]">
            <FileText className="h-3 w-3 mr-1" /> PDF
          </Button>
          <Button
            onClick={async () => { await pruneNow(); toast.success('Pruned old snapshots'); }}
            size="sm" variant="outline" className="h-7 text-[10px]"
          >
            <Trash2 className="h-3 w-3 mr-1" /> Prune
          </Button>
          <span className={`flex items-center gap-1.5 text-[10px] font-display uppercase tracking-widest ${isRunning ? 'text-primary' : 'text-muted-foreground'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
            {isRunning ? 'Live' : 'Idle'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="text-left font-display font-medium py-2">Strategy</th>
              <th className="text-right font-display font-medium py-2">Win Rate</th>
              <th className="text-right font-display font-medium py-2 hidden sm:table-cell">Trend</th>
              <th className="text-right font-display font-medium py-2">Trades</th>
              <th className="text-right font-display font-medium py-2 hidden sm:table-cell">Updated</th>
              <th className="text-right font-display font-medium py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const wr = r.winRate * 100;
              const tooLow = r.trades > 20 && r.winRate < threshold;
              const wrColor = wr >= 55 ? 'text-primary' : wr >= threshold * 100 ? 'text-accent' : 'text-destructive';
              const series = seriesFor(r.name).map(p => p.winRate * 100);
              return (
                <tr
                  key={r.name}
                  onClick={() => setSelected(r)}
                  className={`border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/20 ${tooLow ? 'bg-destructive/5' : ''}`}
                >
                  <td className="py-2 font-display text-foreground">{labelMap[r.name] ?? r.name}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${wr >= 55 ? 'bg-primary' : wr >= threshold * 100 ? 'bg-accent' : 'bg-destructive'}`}
                          style={{ width: `${Math.min(100, Math.max(0, wr))}%` }}
                        />
                      </div>
                      <span className={`font-mono ${wrColor}`}>{wr.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-right hidden sm:table-cell">
                    <div className="inline-block">
                      <Sparkline
                        data={series}
                        stroke={tooLow ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
                        fill={tooLow ? 'hsl(var(--destructive) / 0.15)' : 'hsl(var(--primary) / 0.15)'}
                      />
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono text-muted-foreground">{r.trades}</td>
                  <td className="py-2 text-right font-mono text-[10px] text-muted-foreground hidden sm:table-cell">{fmtAgo(r.lastUpdate)}</td>
                  <td className="py-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider ${
                        !tooLow
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-destructive/30 bg-destructive/10 text-destructive animate-pulse'
                      }`}
                    >
                      <span className={`h-1 w-1 rounded-full ${!tooLow ? 'bg-primary' : 'bg-destructive'}`} />
                      {!tooLow ? 'Healthy' : 'Deprecated'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">
                  No psychology data yet — start the bot to begin tracking.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StrategyDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        row={selected}
        history={selected ? seriesFor(selected.name) : []}
        recentTrades={recent}
        label={selected ? (labelMap[selected.name] ?? selected.name) : ''}
      />
    </div>
  );
};

export default PsychologyHealthPanel;
