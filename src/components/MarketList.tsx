import React from 'react';
import type { Market } from '@/lib/neural-bot-engine';
import { Badge } from '@/components/ui/badge';

interface MarketListProps {
  markets: Market[];
  onSelect: (market: Market) => void;
}

const MarketList: React.FC<MarketListProps> = ({ markets, onSelect }) => (
  <div className="rounded-lg border border-border bg-card flex flex-col">
    <div className="p-3 border-b border-border flex items-center justify-between gap-2">
      <div>
        <h2 className="font-display text-sm font-semibold text-foreground tracking-wide">Monitored Markets</h2>
        <p className="text-[10px] text-muted-foreground mt-0.5">Scroll · click to inspect</p>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground">{markets.length}</span>
    </div>
    <div className="divide-y divide-border max-h-[280px] overflow-y-auto terminal-scrollbar">
      {markets.map((m) => {
        const yesPrice = m.outcomePrices[0];
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m)}
            className="w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3 group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate group-hover:text-primary transition-colors">
                {m.question}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-muted-foreground">
                  {m.category?.toUpperCase() || 'GEN'}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  Vol: ${(m.volume / 1000).toFixed(0)}K
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-display font-bold ${yesPrice > 0.6 ? 'text-primary' : yesPrice < 0.4 ? 'text-destructive' : 'text-foreground'}`}>
                {(yesPrice * 100).toFixed(1)}¢
              </p>
              <p className="text-[9px] text-muted-foreground">YES</p>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

export default MarketList;
