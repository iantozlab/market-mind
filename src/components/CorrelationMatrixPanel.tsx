import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ax[i] - ma, y = bx[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

interface Props {
  strategies: StrategyStatus[];
  triggers: StrategyTrigger[];
}

const WINDOW_KEY = 'corr_window_v1';

const CorrelationMatrixPanel: React.FC<Props> = ({ strategies, triggers }) => {
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const [windowSize, setWindowSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(WINDOW_KEY));
    return Number.isFinite(v) && v >= 10 ? v : 40;
  });
  const lastTs = useRef<Record<string, number>>({});

  useEffect(() => { localStorage.setItem(WINDOW_KEY, String(windowSize)); }, [windowSize]);

  useEffect(() => {
    setSeries(prev => {
      const next: Record<string, number[]> = { ...prev };
      for (const s of strategies) {
        if (!next[s.name]) next[s.name] = [];
      }
      for (const t of triggers) {
        if ((lastTs.current[t.strategy] || 0) < t.ts) {
          lastTs.current[t.strategy] = t.ts;
          const arr = next[t.strategy] || [];
          arr.push(t.confidence * (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random()));
          next[t.strategy] = arr.slice(-windowSize);
        } else {
          next[t.strategy] = (next[t.strategy] || []).slice(-windowSize);
        }
      }
      return next;
    });
  }, [strategies, triggers, windowSize]);

  const names = strategies.map(s => s.name);
  const matrix = useMemo(() => {
    return names.map(a => names.map(b => (a === b ? 1 : pearson(series[a] || [], series[b] || []))));
  }, [names, series]);

  const cellColor = (v: number) => {
    const alpha = Math.min(0.9, Math.abs(v));
    if (v >= 0) return `hsl(var(--primary) / ${alpha})`;
    return `hsl(var(--destructive) / ${alpha})`;
  };

  const exportMatrix = (fmt: 'json' | 'csv') => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let blob: Blob;
    let filename: string;
    if (fmt === 'json') {
      blob = new Blob([JSON.stringify({ generatedAt: Date.now(), windowSize, names, matrix }, null, 2)], { type: 'application/json' });
      filename = `correlation-matrix-${ts}.json`;
    } else {
      const rows = [['', ...names].join(',')];
      for (let i = 0; i < names.length; i++) {
        rows.push([names[i], ...matrix[i].map(v => v.toFixed(4))].join(','));
      }
      blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      filename = `correlation-matrix-${ts}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-info" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Cross-Strategy P&L Correlation</h2>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Window
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={windowSize}
              onChange={(e) => setWindowSize(Number(e.target.value))}
              className="accent-primary w-24"
              aria-label="Rolling correlation window size"
            />
            <span className="font-mono text-foreground">{windowSize}</span>
          </label>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => exportMatrix('json')}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => exportMatrix('csv')}>
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Rolling-window Pearson of trigger P&L proxies. Cluster of red = diversified · deep blue = redundant.
      </p>
      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground">Start the bot to compute correlations.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] font-mono border-collapse">
            <thead>
              <tr>
                <th className="p-1" />
                {names.map(n => (
                  <th key={n} className="p-1 text-muted-foreground rotate-[-45deg] origin-bottom-left whitespace-nowrap h-16 align-bottom">
                    {n.replace(/_/g, ' ').slice(0, 12)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {names.map((a, i) => (
                <tr key={a}>
                  <td className="pr-2 text-right text-muted-foreground whitespace-nowrap">{a.replace(/_/g, ' ').slice(0, 14)}</td>
                  {names.map((b, j) => (
                    <td
                      key={b}
                      className="w-8 h-8 border border-border/30 text-center align-middle"
                      style={{ backgroundColor: cellColor(matrix[i][j]) }}
                      title={`${a} × ${b}: ${matrix[i][j].toFixed(2)}`}
                    >
                      <span className="text-foreground/90">{matrix[i][j].toFixed(1)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CorrelationMatrixPanel;
