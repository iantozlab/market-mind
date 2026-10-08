import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { MarketPriceHistory } from '@/lib/position-manager';

interface PriceChartsPanelProps {
  priceHistories: MarketPriceHistory[];
}

const PriceChartsPanel: React.FC<PriceChartsPanelProps> = ({ priceHistories }) => {
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Show top 6 markets with most price movement
  const sorted = [...priceHistories]
    .filter(h => h.points.length > 1)
    .sort((a, b) => {
      const aRange = a.points.length > 1 ? Math.max(...a.points.map(p => p.price)) - Math.min(...a.points.map(p => p.price)) : 0;
      const bRange = b.points.length > 1 ? Math.max(...b.points.map(p => p.price)) - Math.min(...b.points.map(p => p.price)) : 0;
      return bRange - aRange;
    })
    .slice(0, 6);

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">
          Live Market Price Charts
        </h2>
        <p className="text-xs text-muted-foreground text-center py-8">
          Start the bot to see live price charts. Prices update every 2 seconds from Polymarket.
        </p>
      </div>
    );
  }

  const selected = sorted[Math.min(selectedIdx, sorted.length - 1)];
  const data = selected.points.map(p => ({
    time: p.time,
    price: Number(p.price.toFixed(4)),
  }));

  const prices = selected.points.map(p => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const yDomain = [
    Math.max(0, Math.floor((minPrice - 0.02) * 100) / 100),
    Math.min(1, Math.ceil((maxPrice + 0.02) * 100) / 100),
  ];

  const firstPrice = prices[0] ?? 0;
  const lastPrice = prices[prices.length - 1] ?? 0;
  const priceChange = lastPrice - firstPrice;
  const priceChangePct = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0;
  const isUp = priceChange >= 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-semibold text-foreground tracking-wide">
          Live Market Price Charts
        </h2>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${isUp ? 'text-green-500' : 'text-red-500'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(priceChangePct).toFixed(2)}%
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            ${lastPrice.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Market selector tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {sorted.map((h, i) => {
          const last = h.points[h.points.length - 1]?.price ?? 0;
          const first = h.points[0]?.price ?? 0;
          const change = first > 0 ? ((last - first) / first) * 100 : 0;
          const isActive = i === Math.min(selectedIdx, sorted.length - 1);
          return (
            <button
              key={h.marketId}
              onClick={() => setSelectedIdx(i)}
              className={`shrink-0 rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                isActive
                  ? 'bg-primary/20 border border-primary/40 text-primary'
                  : 'bg-background/40 border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {h.slug.slice(0, 20)}
              <span className={`ml-1 ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {change >= 0 ? '+' : ''}{change.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected market chart */}
      <div className="mb-2">
        <p className="text-xs text-muted-foreground truncate mb-2">{selected.question}</p>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="priceLineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}¢`}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 11,
              color: 'hsl(var(--foreground))',
            }}
            labelStyle={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}
            formatter={(value: number) => [`${(value * 100).toFixed(2)}¢`, 'Price']}
          />
          <ReferenceLine y={firstPrice} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.3} />
          <Line
            type="monotone"
            dataKey="price"
            stroke={isUp ? '#22c55e' : '#ef4444'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: isUp ? '#22c55e' : '#ef4444' }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>Open: {(firstPrice * 100).toFixed(2)}¢</span>
        <span>High: {(Math.max(...prices) * 100).toFixed(2)}¢</span>
        <span>Low: {(Math.min(...prices) * 100).toFixed(2)}¢</span>
        <span>Now: {(lastPrice * 100).toFixed(2)}¢</span>
      </div>
    </div>
  );
};

export default PriceChartsPanel;
