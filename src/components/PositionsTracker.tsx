import React from 'react';
import type { Position } from '@/lib/neural-bot-engine';

interface PositionsTrackerProps {
  positions: Position[];
}

const PositionsTracker: React.FC<PositionsTrackerProps> = ({ positions }) => {
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnL, 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-semibold text-foreground tracking-wide">
          Open Positions ({positions.length})
        </h2>
        <span className={`font-display text-sm font-bold ${totalUnrealized >= 0 ? 'text-primary text-glow' : 'text-destructive'}`}>
          {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toFixed(2)} USD
        </span>
      </div>

      {positions.length === 0 ? (
        <p className="text-xs text-muted-foreground animate-pulse-glow py-4 text-center">
          No open positions — awaiting trade signals...
        </p>
      ) : (
        <div className="space-y-0 overflow-hidden rounded-md border border-border">
          {/* Header */}
          <div className="grid grid-cols-12 gap-1 px-3 py-1.5 bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground font-display">
            <div className="col-span-4">Market</div>
            <div className="col-span-1 text-center">Side</div>
            <div className="col-span-1 text-right">Size</div>
            <div className="col-span-2 text-right">Entry</div>
            <div className="col-span-2 text-right">Current</div>
            <div className="col-span-2 text-right">P&L</div>
          </div>

          {/* Rows */}
          {positions.map((pos) => {
            const pnlPct = pos.entryPrice > 0 ? ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1) : 0;
            return (
              <div
                key={pos.id}
                className="grid grid-cols-12 gap-1 px-3 py-2 text-xs border-t border-border/50 hover:bg-muted/20 transition-colors"
              >
                <div className="col-span-4 truncate text-foreground font-medium" title={pos.marketQuestion}>
                  {pos.marketQuestion.slice(0, 35)}{pos.marketQuestion.length > 35 ? '…' : ''}
                </div>
                <div className="col-span-1 text-center">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-display font-bold ${
                    pos.side === 'LONG' ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                  }`}>
                    {pos.side}
                  </span>
                </div>
                <div className="col-span-1 text-right text-muted-foreground font-mono">{pos.size}</div>
                <div className="col-span-2 text-right text-muted-foreground font-mono">{pos.entryPrice.toFixed(3)}</div>
                <div className="col-span-2 text-right text-foreground font-mono">{pos.currentPrice.toFixed(3)}</div>
                <div className={`col-span-2 text-right font-mono font-bold ${pos.unrealizedPnL >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {pos.unrealizedPnL >= 0 ? '+' : ''}{pos.unrealizedPnL.toFixed(2)}
                  <span className="text-[10px] text-muted-foreground ml-1">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PositionsTracker;
