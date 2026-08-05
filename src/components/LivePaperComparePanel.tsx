import React, { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RefreshCw, Download, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  slippage: number[];
  prices: number[];
}

function emptySide(): Side {
  return { executions: 0, blocked: 0, profit: 0, wins: 0, series: new Array(BUCKETS).fill(0), reasons: {}, slippage: [], prices: [] };
}

function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function pctile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
  const [reasonDrill, setReasonDrill] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchArbAudit(range, 1000)); } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const { paper, live, from, to, windowRows } = useMemo(() => {
    const now = Date.now();
    const start = now - range;
    const p = emptySide(), l = emptySide();
    const inWindow: ArbAuditEntry[] = [];
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t) || t < start) continue;
      inWindow.push(r);
      const side = r.mode === 'live' ? l : p;
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((t - start) / range) * BUCKETS)));
      if (r.action === 'executed') {
        side.executions++;
        side.profit += r.profit;
        if (r.profit > 0) side.wins++;
        side.series[idx] += r.profit;
        const slip = num(r.detail?.slippageBps);
        if (slip != null) side.slippage.push(slip);
        const px = num(r.detail?.execPrice);
        if (px != null) side.prices.push(px);
      } else if (r.action === 'blocked') {
        side.blocked++;
        const key = r.reason ?? 'unspecified';
        side.reasons[key] = (side.reasons[key] ?? 0) + 1;
      }
    }
    for (const side of [p, l]) {
      let cum = 0;
      side.series = side.series.map(v => (cum += v));
      side.slippage.sort((a, b) => a - b);
      side.prices.sort((a, b) => a - b);
    }
    return { paper: p, live: l, from: start, to: now, windowRows: inWindow };
  }, [rows, range]);

  const reasonKeys = useMemo(() => {
    const all = new Set([...Object.keys(paper.reasons), ...Object.keys(live.reasons)]);
    return [...all].sort((a, b) => (live.reasons[b] ?? 0) + (paper.reasons[b] ?? 0) - ((live.reasons[a] ?? 0) + (paper.reasons[a] ?? 0)));
  }, [paper, live]);

  const drillRows = useMemo(
    () => (reasonDrill ? windowRows.filter(r => r.action === 'blocked' && (r.reason ?? 'unspecified') === reasonDrill) : []),
    [reasonDrill, windowRows],
  );

  const pct = (s: Side) => (s.executions ? ((s.wins / s.executions) * 100).toFixed(1) : '0.0');
  const fmt = (v: number | null, suffix = '') => (v == null ? '—' : `${v.toFixed(suffix === ' bps' ? 1 : 4)}${suffix}`);

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

      {/* Execution price & slippage percentiles */}
      <section className="rounded-lg border border-border bg-card p-3 space-y-2">
        <h4 className="font-display text-xs font-semibold">Fill quality — price &amp; slippage percentiles</h4>
        {paper.slippage.length + live.slippage.length === 0 ? (
          <p className="text-xs text-muted-foreground">No fills with recorded execution prices in this window yet.</p>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="text-left py-1">metric</th><th className="text-right">p50</th><th className="text-right">p90</th>
                <th className="text-right">p99</th><th className="text-right">samples</th>
              </tr>
            </thead>
            <tbody>
              {([['paper', paper, 'text-primary'], ['live', live, 'text-warning']] as [string, Side, string][]).flatMap(([name, s, tone]) => [
                <tr key={`${name}-slip`} className="border-b border-border/30">
                  <td className={`py-1 ${tone}`}>{name} slippage</td>
                  <td className="text-right">{fmt(pctile(s.slippage, 50), ' bps')}</td>
                  <td className="text-right">{fmt(pctile(s.slippage, 90), ' bps')}</td>
                  <td className="text-right">{fmt(pctile(s.slippage, 99), ' bps')}</td>
                  <td className="text-right text-muted-foreground">{s.slippage.length}</td>
                </tr>,
                <tr key={`${name}-px`} className="border-b border-border/30">
                  <td className={`py-1 ${tone}`}>{name} exec price</td>
                  <td className="text-right">{fmt(pctile(s.prices, 50))}</td>
                  <td className="text-right">{fmt(pctile(s.prices, 90))}</td>
                  <td className="text-right">{fmt(pctile(s.prices, 99))}</td>
                  <td className="text-right text-muted-foreground">{s.prices.length}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-muted-foreground">
          A wider live slippage tail against the same signals is the usual explanation for P&amp;L divergence.
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
                  <tr
                    key={k}
                    className="border-b border-border/30 cursor-pointer hover:bg-muted/40"
                    onClick={() => setReasonDrill(k)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect blocked reason ${k}`}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReasonDrill(k); } }}
                  >
                    <td className="py-1 truncate max-w-[16rem]"><Info className="inline h-3 w-3 mr-1 text-info" aria-hidden />{k}</td>
                    <td className="text-right text-warning">{p}</td>
                    <td className="text-right text-destructive">{l}</td>
                    <td className={`text-right ${l - p === 0 ? 'text-muted-foreground' : l > p ? 'text-destructive' : 'text-primary'}`}>{l - p > 0 ? `+${l - p}` : l - p}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">Click a reason to see the exact rule, strategy tag and parameter values behind it.</p>
      </section>

      <Dialog open={!!reasonDrill} onOpenChange={o => !o && setReasonDrill(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-sm">Why this was blocked</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">{reasonDrill}</DialogDescription>
          </DialogHeader>
          {drillRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No detail rows retained for this reason.</p>
          ) : (
            <div className="space-y-3">
              {(['paper', 'live'] as const).map(m => {
                const list = drillRows.filter(r => r.mode === m);
                return (
                  <div key={m} className="rounded-md border border-border/60 p-2">
                    <p className="mb-1 flex items-center gap-2 text-[11px] font-mono">
                      <Badge variant={m === 'live' ? 'destructive' : 'secondary'} className="text-[9px]">{m}</Badge>
                      {list.length} blocked
                    </p>
                    {list.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">None in this window.</p>
                    ) : (
                      <ul className="space-y-2">
                        {list.slice(0, 6).map((r, i) => {
                          const d = (r.detail ?? {}) as Record<string, unknown>;
                          const limitsShown = Object.entries(d).filter(([k]) => k.startsWith('limit_'));
                          const valuesShown = Object.entries(d).filter(([k]) => k.startsWith('value_'));
                          return (
                            <li key={r.id ?? `${m}-${i}`} className="border-t border-border/30 pt-1 text-[10px] font-mono">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</span>
                                <Badge variant="outline" className="text-[9px]">{String(d.strategy ?? r.source)}</Badge>
                                <span className="truncate max-w-[14rem]">{r.label}</span>
                                <span className="text-muted-foreground">conf {(r.confidence * 100).toFixed(0)}% · {r.legs} legs · ${r.capital.toFixed(0)}</span>
                              </div>
                              <div className="mt-1 grid grid-cols-2 gap-x-4">
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground">rule params</p>
                                  {limitsShown.length === 0 ? <p className="text-muted-foreground">—</p> : limitsShown.map(([k, v]) => (
                                    <p key={k}>{k.replace('limit_', '')}: <span className="text-info">{String(v)}</span></p>
                                  ))}
                                </div>
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground">observed</p>
                                  {valuesShown.length === 0 ? <p className="text-muted-foreground">—</p> : valuesShown.map(([k, v]) => (
                                    <p key={k}>{k.replace('value_', '')}: <span className="text-warning">{String(v)}</span></p>
                                  ))}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LivePaperComparePanel;
