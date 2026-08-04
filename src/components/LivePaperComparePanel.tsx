import React, { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Sparkline from '@/components/Sparkline';
import { fetchArbAudit, arbAuditToCsv, type ArbAuditEntry } from '@/lib/arb-audit';

const RANGES: [string, number][] = [['1h', 3600e3], ['6h', 6 * 3600e3], ['24h', 86400e3], ['7d', 604800e3]];
const BUCKETS = 24;

interface Side {
  executions: number;
  blocked: number;
  profit: number;
  wins: number;
  series: number[];
  reasons: Record<string, number>;
}

function emptySide(): Side {
  return { executions: 0, blocked: 0, profit: 0, wins: 0, series: new Array(BUCKETS).fill(0), reasons: {} };
}

function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const Stat: React.FC<{ label: string; paper: string; live: string; paperTone?: string; liveTone?: string }> = ({
  label, paper, live, paperTone = 'text-primary', liveTone = 'text-warning',
}) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
    <div className="mt-1 flex items-baseline gap-3 font-mono">
      <span className={`text-lg ${paperTone}`}>{paper}</span>
      <span className="text-[10px] text-muted-foreground">paper</span>
      <span className={`text-lg ${liveTone}`}>{live}</span>
      <span className="text-[10px] text-muted-foreground">live</span>
    </div>
  </div>
);

const LivePaperComparePanel: React.FC = () => {
  const [range, setRange] = useState(86400e3);
  const [rows, setRows] = useState<ArbAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchArbAudit(range, 1000)); } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const { paper, live, from, to } = useMemo(() => {
    const now = Date.now();
    const start = now - range;
    const p = emptySide(), l = emptySide();
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t) || t < start) continue;
      const side = r.mode === 'live' ? l : p;
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((t - start) / range) * BUCKETS)));
      if (r.action === 'executed') {
        side.executions++;
        side.profit += r.profit;
        if (r.profit > 0) side.wins++;
        side.series[idx] += r.profit;
      } else if (r.action === 'blocked') {
        side.blocked++;
        const key = r.reason ?? 'unspecified';
        side.reasons[key] = (side.reasons[key] ?? 0) + 1;
      }
    }
    // cumulative P&L curves
    for (const side of [p, l]) {
      let cum = 0;
      side.series = side.series.map(v => (cum += v));
    }
    return { paper: p, live: l, from: start, to: now };
  }, [rows, range]);

  const reasonKeys = useMemo(() => {
    const all = new Set([...Object.keys(paper.reasons), ...Object.keys(live.reasons)]);
    return [...all].sort((a, b) => (live.reasons[b] ?? 0) + (paper.reasons[b] ?? 0) - ((live.reasons[a] ?? 0) + (paper.reasons[a] ?? 0)));
  }, [paper, live]);

  const pct = (s: Side) => (s.executions ? ((s.wins / s.executions) * 100).toFixed(1) : '0.0');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
          <GitCompareArrows className="h-4 w-4 text-info" aria-hidden /> Live vs Paper Execution
        </h3>
        <span className="flex-1" />
        {RANGES.map(([lbl, ms]) => (
          <Button key={lbl} size="sm" variant={range === ms ? 'default' : 'outline'} className="h-7 text-xs"
            onClick={() => setRange(ms)} aria-label={`Compare last ${lbl}`}>{lbl}</Button>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={load} disabled={loading} aria-label="Refresh comparison">
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} aria-hidden />Refresh
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => download(`live-vs-paper-${Date.now()}.csv`, arbAuditToCsv(rows))} aria-label="Export comparison CSV">
          <Download className="h-3 w-3 mr-1" aria-hidden />CSV
        </Button>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground">
        {new Date(from).toLocaleString()} → {new Date(to).toLocaleTimeString()} · {rows.length} audited actions
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label="Executions" paper={String(paper.executions)} live={String(live.executions)} />
        <Stat label="Blocked" paper={String(paper.blocked)} live={String(live.blocked)} paperTone="text-warning" liveTone="text-destructive" />
        <Stat label="P&L" paper={`$${paper.profit.toFixed(2)}`} live={`$${live.profit.toFixed(2)}`} />
        <Stat label="Hit rate" paper={`${pct(paper)}%`} live={`${pct(live)}%`} />
      </div>

      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h4 className="font-display text-xs font-semibold">Cumulative P&amp;L overlay</h4>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[9px]">paper</Badge>
            <Sparkline data={paper.series} width={220} height={40} />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">live</Badge>
            <Sparkline data={live.series} width={220} height={40} stroke="hsl(var(--warning))" fill="hsl(var(--warning) / 0.15)" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Both curves share the same {BUCKETS}-bucket window, so divergence between simulated and real fills is directly comparable.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h4 className="font-display text-xs font-semibold mb-2">Blocked reasons — paper vs live</h4>
        {reasonKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No blocked actions in this window.</p>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="text-left py-1">reason</th><th className="text-right">paper</th><th className="text-right">live</th><th className="text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {reasonKeys.map(k => {
                const p = paper.reasons[k] ?? 0, l = live.reasons[k] ?? 0;
                return (
                  <tr key={k} className="border-b border-border/30">
                    <td className="py-1 truncate max-w-[16rem]">{k}</td>
                    <td className="text-right text-warning">{p}</td>
                    <td className="text-right text-destructive">{l}</td>
                    <td className={`text-right ${l - p === 0 ? 'text-muted-foreground' : l > p ? 'text-destructive' : 'text-primary'}`}>{l - p > 0 ? `+${l - p}` : l - p}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default LivePaperComparePanel;
