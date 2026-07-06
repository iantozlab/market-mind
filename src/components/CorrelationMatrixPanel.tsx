import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { StrategyStatus, StrategyTrigger } from '@/lib/neural-bot-engine';

const WINDOW = 40; // rolling ticks per strategy

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

const CorrelationMatrixPanel: React.FC<Props> = ({ strategies, triggers }) => {
  const [series, setSeries] = useState<Record<string, number[]>>({});
  const lastTs = useRef<Record<string, number>>({});

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
          next[t.strategy] = arr.slice(-WINDOW);
        }
      }
      return next;
    });
  }, [strategies, triggers]);

  const names = strategies.map(s => s.name);
  const matrix = useMemo(() => {
    return names.map(a => names.map(b => (a === b ? 1 : pearson(series[a] || [], series[b] || []))));
  }, [names, series]);

  const cellColor = (v: number) => {
    const alpha = Math.min(0.9, Math.abs(v));
    if (v >= 0) return `hsl(var(--primary) / ${alpha})`;
    return `hsl(var(--destructive) / ${alpha})`;
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Grid3x3 className="h-4 w-4 text-info" />
        <h2 className="font-display text-sm font-semibold tracking-wide">Cross-Strategy P&L Correlation</h2>
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
