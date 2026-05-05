// Lightweight backtest engine adapted from Polymarket Sentinel.
// Self-contained: simulates synthetic markets, runs a simple
// market-making + deep-value strategy, and reports performance metrics.

export interface BacktestConfig {
  durationDays: number;
  initialCapital: number;
  marketCount: number;
  granularity: 'hourly' | 'daily';
  stopLoss: number;   // 0..1 (e.g., 0.10 = 10%)
  takeProfit: number; // 0..1
  maxPositionSize: number; // dollars
  maxActiveMarkets: number;
}

export interface BacktestTrade {
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;
  shares: number;
  timestamp: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  sharpeRatio: number;
  equityCurve: { t: number; equity: number }[];
  trades: BacktestTrade[];
  runtimeMs: number;
}

interface Position {
  marketId: string;
  yesShares: number;
  noShares: number;
  yesAvg: number;
  noAvg: number;
  entryT: number;
}

interface SimMarket {
  id: string;
  prices: { t: number; yes: number; vol: number }[];
  resolution: 'YES' | 'NO' | null;
}

function genMarkets(cfg: BacktestConfig): SimMarket[] {
  const stepMs = cfg.granularity === 'hourly' ? 3_600_000 : 86_400_000;
  const start = Date.now() - cfg.durationDays * 86_400_000;
  const end = Date.now();
  const markets: SimMarket[] = [];
  for (let i = 0; i < cfg.marketCount; i++) {
    const resolution: SimMarket['resolution'] = Math.random() < 0.7 ? (Math.random() < 0.5 ? 'YES' : 'NO') : null;
    const prices: SimMarket['prices'] = [];
    let p = 0.3 + Math.random() * 0.4;
    let vol = 0.02 + Math.random() * 0.03;
    for (let t = start; t <= end; t += stepMs) {
      if (Math.random() < 0.02) vol = 0.05 + Math.random() * 0.08;
      else if (Math.random() < 0.1) vol = 0.02 + Math.random() * 0.03;
      const drift = resolution === 'YES' ? 0.0008 : resolution === 'NO' ? -0.0008 : 0;
      p += drift + (Math.random() - 0.5) * 2 * vol;
      p = Math.max(0.01, Math.min(0.99, p));
      prices.push({ t, yes: p, vol });
    }
    if (resolution && prices.length > 10) {
      const cs = Math.floor(prices.length * 0.8);
      const target = resolution === 'YES' ? 0.99 : 0.01;
      for (let j = cs; j < prices.length; j++) {
        const w = Math.pow((j - cs) / (prices.length - cs), 2);
        prices[j].yes = prices[j].yes * (1 - w) + target * w;
      }
    }
    markets.push({ id: `bt_${i}`, prices, resolution });
  }
  return markets;
}

export function runBacktest(cfg: BacktestConfig): BacktestResult {
  const start = performance.now();
  const markets = genMarkets(cfg);
  const positions = new Map<string, Position>();
  const trades: BacktestTrade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];
  let cash = cfg.initialCapital;
  let used = 0;
  let peak = cash;
  let maxDD = 0;
  const realized: number[] = [];

  const allTs = Array.from(new Set(markets.flatMap(m => m.prices.map(p => p.t)))).sort((a, b) => a - b);

  for (const t of allTs) {
    // mark-to-market & exits
    for (const m of markets) {
      const dp = m.prices.find(p => p.t === t);
      if (!dp) continue;
      const yesP = dp.yes;
      const noP = 1 - yesP;
      const pos = positions.get(m.id);
      if (!pos) continue;
      const value = pos.yesShares * yesP + pos.noShares * noP;
      const cost = pos.yesShares * pos.yesAvg + pos.noShares * pos.noAvg;
      const pnlPct = cost > 0 ? (value - cost) / cost : 0;
      const hold = t - pos.entryT;
      if (pnlPct >= cfg.takeProfit || pnlPct <= -cfg.stopLoss || hold > 7 * 86_400_000) {
        cash += value;
        used -= cost;
        realized.push(value - cost);
        if (pos.yesShares > 0) trades.push({ marketId: m.id, side: 'SELL', outcome: 'YES', price: yesP, shares: pos.yesShares, timestamp: t });
        if (pos.noShares > 0) trades.push({ marketId: m.id, side: 'SELL', outcome: 'NO', price: noP, shares: pos.noShares, timestamp: t });
        positions.delete(m.id);
      }
    }

    // entries
    if (positions.size < cfg.maxActiveMarkets) {
      for (const m of markets) {
        if (positions.has(m.id)) continue;
        const dp = m.prices.find(p => p.t === t);
        if (!dp) continue;
        const yesP = dp.yes, noP = 1 - yesP;
        const deepSide = yesP < 0.08 ? 'YES' : noP < 0.08 ? 'NO' : null;
        if (deepSide) {
          const price = deepSide === 'YES' ? yesP : noP;
          const size = Math.min(cash * 0.05, cfg.maxPositionSize);
          const shares = Math.floor(size / price);
          if (shares > 0 && cash >= shares * price) {
            trades.push({ marketId: m.id, side: 'BUY', outcome: deepSide, price, shares, timestamp: t });
            cash -= shares * price;
            used += shares * price;
            positions.set(m.id, {
              marketId: m.id,
              yesShares: deepSide === 'YES' ? shares : 0,
              noShares: deepSide === 'NO' ? shares : 0,
              yesAvg: deepSide === 'YES' ? price : 0,
              noAvg: deepSide === 'NO' ? price : 0,
              entryT: t,
            });
          }
        } else if (dp.vol > 0.04 && Math.abs(yesP - 0.5) < 0.2) {
          const size = Math.min(cash * 0.08, cfg.maxPositionSize);
          const half = size / 2;
          const ys = Math.floor(half / yesP);
          const ns = Math.floor(half / noP);
          const cost = ys * yesP + ns * noP;
          if (ys > 0 && ns > 0 && cash >= cost) {
            trades.push({ marketId: m.id, side: 'BUY', outcome: 'YES', price: yesP, shares: ys, timestamp: t });
            trades.push({ marketId: m.id, side: 'BUY', outcome: 'NO', price: noP, shares: ns, timestamp: t });
            cash -= cost;
            used += cost;
            positions.set(m.id, { marketId: m.id, yesShares: ys, noShares: ns, yesAvg: yesP, noAvg: noP, entryT: t });
          }
        }
      }
    }

    const equity = cash + used;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    equityCurve.push({ t, equity });
  }

  const wins = realized.filter(r => r > 0).length;
  const winRate = realized.length > 0 ? wins / realized.length : 0;
  const mean = realized.reduce((a, b) => a + b, 0) / (realized.length || 1);
  const std = Math.sqrt(realized.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (realized.length || 1));
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  const endEquity = cash + used;
  return {
    config: cfg,
    startEquity: cfg.initialCapital,
    endEquity,
    totalReturnPct: ((endEquity - cfg.initialCapital) / cfg.initialCapital) * 100,
    maxDrawdownPct: maxDD * 100,
    winRate,
    totalTrades: trades.length,
    sharpeRatio: sharpe,
    equityCurve,
    trades,
    runtimeMs: performance.now() - start,
  };
}
