import React from 'react';
import type { Market, OrderBook, Trade } from '@/lib/neural-bot-engine';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface MarketDetailPanelProps {
  market: Market | null;
  orderBook: OrderBook | null;
  trades: Trade[];
  open: boolean;
  onClose: () => void;
}

const MarketDetailPanel: React.FC<MarketDetailPanelProps> = ({ market, orderBook, trades, open, onClose }) => {
  if (!market) return null;

  const bidDepth = orderBook?.bids.slice(0, 10).reduce((s, b) => s + b.size, 0) || 0;
  const askDepth = orderBook?.asks.slice(0, 10).reduce((s, a) => s + a.size, 0) || 0;
  const spread = orderBook && orderBook.asks[0] && orderBook.bids[0]
    ? (orderBook.asks[0].price - orderBook.bids[0].price).toFixed(4)
    : '—';

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg bg-background border-border p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b border-border">
          <SheetTitle className="font-display text-sm tracking-wide text-foreground leading-tight">
            {market.question}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
              {market.category?.toUpperCase() || 'GENERAL'}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              Vol: ${(market.volume / 1000).toFixed(0)}K · Liq: ${(market.liquidity / 1000).toFixed(0)}K
            </span>
          </SheetDescription>
        </SheetHeader>

        {/* Price summary */}
        <div className="grid grid-cols-3 gap-2 p-4 border-b border-border">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Yes</p>
            <p className="text-lg font-display font-bold text-primary text-glow">{(market.outcomePrices[0] * 100).toFixed(1)}¢</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Spread</p>
            <p className="text-lg font-display font-bold text-foreground">{spread}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">No</p>
            <p className="text-lg font-display font-bold text-destructive">{(market.outcomePrices[1] * 100).toFixed(1)}¢</p>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            {/* Order Book */}
            <div>
              <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Order Book
                <span className="ml-2 text-[10px] normal-case text-muted-foreground/70">
                  Bid depth: {bidDepth.toFixed(0)} · Ask depth: {askDepth.toFixed(0)}
                </span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {/* Bids */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-primary mb-1 font-display">Bids</p>
                  <div className="space-y-px">
                    {(orderBook?.bids || []).slice(0, 8).map((level, i) => {
                      const pct = bidDepth > 0 ? (level.size / bidDepth) * 100 : 0;
                      return (
                        <div key={i} className="relative flex items-center justify-between text-[11px] font-mono px-1.5 py-0.5 rounded-sm">
                          <div className="absolute inset-0 bg-primary/10 rounded-sm" style={{ width: `${pct}%` }} />
                          <span className="relative text-primary">{level.price.toFixed(3)}</span>
                          <span className="relative text-muted-foreground">{level.size.toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Asks */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-destructive mb-1 font-display">Asks</p>
                  <div className="space-y-px">
                    {(orderBook?.asks || []).slice(0, 8).map((level, i) => {
                      const pct = askDepth > 0 ? (level.size / askDepth) * 100 : 0;
                      return (
                        <div key={i} className="relative flex items-center justify-between text-[11px] font-mono px-1.5 py-0.5 rounded-sm">
                          <div className="absolute inset-0 right-0 left-auto bg-destructive/10 rounded-sm" style={{ width: `${pct}%` }} />
                          <span className="relative text-destructive">{level.price.toFixed(3)}</span>
                          <span className="relative text-muted-foreground">{level.size.toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Trade History */}
            <div>
              <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Recent Trades <span className="text-[10px] normal-case text-muted-foreground/70">({trades.length} total)</span>
              </h3>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="h-7 text-[10px] px-2">Time</TableHead>
                    <TableHead className="h-7 text-[10px] px-2">Side</TableHead>
                    <TableHead className="h-7 text-[10px] px-2 text-right">Price</TableHead>
                    <TableHead className="h-7 text-[10px] px-2 text-right">Size</TableHead>
                    <TableHead className="h-7 text-[10px] px-2">Trader</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.slice(0, 30).map((trade, i) => (
                    <TableRow key={i} className="border-border">
                      <TableCell className="py-1 px-2 text-[10px] font-mono text-muted-foreground">
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="py-1 px-2">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 ${
                            trade.side === 'BUY'
                              ? 'border-primary/40 text-primary'
                              : 'border-destructive/40 text-destructive'
                          }`}
                        >
                          {trade.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1 px-2 text-[11px] font-mono text-right text-foreground">
                        {trade.price.toFixed(3)}
                      </TableCell>
                      <TableCell className="py-1 px-2 text-[11px] font-mono text-right text-foreground">
                        {trade.amount.toFixed(0)}
                      </TableCell>
                      <TableCell className="py-1 px-2 text-[10px] font-mono text-muted-foreground">
                        {trade.traderAddress.slice(0, 8)}…
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default MarketDetailPanel;
