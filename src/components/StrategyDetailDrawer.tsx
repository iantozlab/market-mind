import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import Sparkline from './Sparkline';
import type { SnapshotPoint } from '@/hooks/usePsychologySnapshots';
import type { PsychologyHealthRow } from './PsychologyHealthPanel';

interface RecentTrade { ts: number; won: boolean; pnl: number }

interface Props {
  open: boolean;
  onClose: () => void;
  row: PsychologyHealthRow | null;
  history: SnapshotPoint[];
  recentTrades: RecentTrade[];
  label: string;
}

const fmtAgo = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const StrategyDetailDrawer: React.FC<Props> = ({ open, onClose, row, history, recentTrades, label }) => {
  if (!row) return null;
  const winRateSeries = history.map(p => p.winRate * 100);
  const tradeSeries = history.map(p => p.trades);
  const last = row.lastUpdate ? fmtAgo(row.lastUpdate) : '—';

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md bg-card border-l border-border overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-foreground tracking-wide">{label}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Last update {last} · {row.trades} trades · WR {(row.winRate * 100).toFixed(1)}%
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Win Rate Over Time</span>
              <span className="text-xs font-mono text-primary">{(row.winRate * 100).toFixed(1)}%</span>
            </div>
            <Sparkline data={winRateSeries} width={300} height={56} />
          </div>

          <div className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Trade Count</span>
              <span className="text-xs font-mono text-accent">{row.trades}</span>
            </div>
            <Sparkline
              data={tradeSeries}
              width={300}
              height={56}
              stroke="hsl(var(--accent))"
              fill="hsl(var(--accent) / 0.15)"
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Recent Trades</div>
            <div className="rounded-md border border-border divide-y divide-border/40 max-h-72 overflow-y-auto">
              {recentTrades.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">No trades recorded yet.</div>
              )}
              {recentTrades.slice(0, 25).map((t, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="font-mono text-muted-foreground">{fmtAgo(t.ts)}</span>
                  <span className={`font-display tracking-wide ${t.won ? 'text-primary' : 'text-destructive'}`}>
                    {t.won ? 'WIN' : 'LOSS'}
                  </span>
                  <span className={`font-mono ${t.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default StrategyDetailDrawer;
