// Position Manager — tracks open positions, manages exits (stop loss,
// take profit, trailing stop, time-based exit), and records price history
// for charting. Runs independently of the main bot loop so that open
// positions continue to be managed even when the bot is stopped.

export interface Position {
  id: string;
  marketId: string;
  marketQuestion: string;
  slug: string;
  side: 'YES' | 'NO';
  outcomeIndex: number;
  entryPrice: number;
  currentPrice: number;
  size: number;        // shares
  cost: number;        // USD spent at entry
  entryTime: number;
  status: 'OPEN' | 'CLOSED';
  closePrice?: number;
  realizedPnl?: number;
  closeTime?: number;
  closeReason?: string;
  unrealizedPnl: number;
  highestPrice: number; // for trailing stop
  mode: 'PAPER' | 'LIVE';
}

export interface PricePoint {
  time: string;
  timestamp: number;
  price: number;
}

export interface MarketPriceHistory {
  marketId: string;
  question: string;
  slug: string;
  points: PricePoint[];
}

export interface PositionSettings {
  stopLossPct: number;       // e.g. -0.25 means exit when down 25%
  takeProfitPct: number;     // e.g. 1.00 means exit when up 100%
  trailingStopPct: number;  // e.g. 0.15 means trail 15% from peak
  timeBasedExitMs: number;   // exit after this many ms
  maxPositionPct: number;    // max % of capital per position
  kellyFraction: number;     // Kelly fraction for sizing
  minTradeSize: number;      // min USD per trade
  maxTradeSize: number;      // max USD per trade
  maxTotalExposurePct: number; // max aggregate exposure
}

const MAX_PRICE_POINTS = 120; // ~4 minutes of data at 2s intervals
const MAX_POSITIONS = 50;

export class PositionManager {
  private positions = new Map<string, Position>();
  private priceHistory = new Map<string, MarketPriceHistory>();
  private capital: number;
  private settings: PositionSettings;
  private onUpdate: (() => void) | null = null;

  constructor(capital: number, settings: PositionSettings) {
    this.capital = capital;
    this.settings = settings;
  }

  setOnUpdate(cb: () => void) { this.onUpdate = cb; }

  setCapital(c: number) { this.capital = c; }

  setSettings(s: Partial<PositionSettings>) {
    this.settings = { ...this.settings, ...s };
  }

  getSettings(): PositionSettings { return { ...this.settings }; }

  /** Record a price point for a market (called every tick). */
  recordPrice(marketId: string, question: string, slug: string, price: number) {
    const now = Date.now();
    const time = new Date().toLocaleTimeString();
    let hist = this.priceHistory.get(marketId);
    if (!hist) {
      hist = { marketId, question, slug, points: [] };
      this.priceHistory.set(marketId, hist);
    }
    hist.question = question;
    hist.slug = slug;
    hist.points.push({ time, timestamp: now, price });
    if (hist.points.length > MAX_PRICE_POINTS) hist.points.shift();
  }

  getPriceHistory(marketId?: string): MarketPriceHistory[] {
    if (marketId) {
      const h = this.priceHistory.get(marketId);
      return h ? [h] : [];
    }
    return Array.from(this.priceHistory.values()).sort((a, b) => {
      const aLast = a.points[a.points.length - 1]?.price ?? 0;
      const bLast = b.points[b.points.length - 1]?.price ?? 0;
      return bLast - aLast;
    });
  }

  /** Open a new position. Returns the position or null if risk limits prevent it. */
  openPosition(params: {
    marketId: string;
    marketQuestion: string;
    slug: string;
    side: 'YES' | 'NO';
    outcomeIndex: number;
    entryPrice: number;
    size: number;
    mode: 'PAPER' | 'LIVE';
  }): Position | null {
    const cost = params.size * params.entryPrice;

    // Check max total exposure
    const openExposure = this.getOpenExposure();
    const maxExposure = this.capital * this.settings.maxTotalExposurePct;
    if (openExposure + cost > maxExposure) return null;

    // Check max position size
    const maxPosCost = this.capital * this.settings.maxPositionPct;
    if (cost > maxPosCost) return null;

    // Check min/max trade size
    if (cost < this.settings.minTradeSize || cost > this.settings.maxTradeSize) return null;

    // Limit number of positions
    if (this.getOpenCount() >= MAX_POSITIONS) return null;

    const id = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const pos: Position = {
      id,
      marketId: params.marketId,
      marketQuestion: params.marketQuestion,
      slug: params.slug,
      side: params.side,
      outcomeIndex: params.outcomeIndex,
      entryPrice: params.entryPrice,
      currentPrice: params.entryPrice,
      size: params.size,
      cost,
      entryTime: Date.now(),
      status: 'OPEN',
      unrealizedPnl: 0,
      highestPrice: params.entryPrice,
      mode: params.mode,
    };
    this.positions.set(id, pos);
    return pos;
  }

  /** Update position prices from current market data. Closes positions that hit exit conditions. */
  managePositions(marketPrices: Map<string, { yesPrice: number; noPrice: number }>): {
    closed: Position[];
    updated: Position[];
  } {
    const closed: Position[] = [];
    const updated: Position[] = [];
    const now = Date.now();

    for (const pos of this.positions.values()) {
      if (pos.status !== 'OPEN') continue;

      const prices = marketPrices.get(pos.marketId);
      if (!prices) {
        updated.push(pos);
        continue;
      }

      const currentPrice = pos.outcomeIndex === 0 ? prices.yesPrice : prices.noPrice;
      pos.currentPrice = currentPrice;
      pos.unrealizedPnl = (currentPrice - pos.entryPrice) * pos.size;

      // Track highest price for trailing stop (for long/YES positions)
      if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;

      updated.push(pos);

      // Check exit conditions
      const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice;
      const trailingDrop = (pos.highestPrice - currentPrice) / pos.highestPrice;
      const ageMs = now - pos.entryTime;

      let closeReason: string | null = null;

      // Stop loss
      if (pnlPct <= this.settings.stopLossPct) {
        closeReason = 'stop-loss';
      }
      // Take profit
      else if (pnlPct >= this.settings.takeProfitPct) {
        closeReason = 'take-profit';
      }
      // Trailing stop
      else if (pos.highestPrice > pos.entryPrice && trailingDrop >= this.settings.trailingStopPct) {
        closeReason = 'trailing-stop';
      }
      // Time-based exit
      else if (ageMs >= this.settings.timeBasedExitMs) {
        closeReason = 'time-exit';
      }
      // Market resolved (price near 0 or 1)
      else if (currentPrice >= 0.98 || currentPrice <= 0.02) {
        closeReason = 'market-resolved';
      }

      if (closeReason) {
        pos.status = 'CLOSED';
        pos.closePrice = currentPrice;
        pos.realizedPnl = (currentPrice - pos.entryPrice) * pos.size;
        pos.closeTime = now;
        pos.closeReason = closeReason;
        closed.push(pos);
      }
    }

    if (closed.length > 0 || updated.length > 0) this.onUpdate?.();
    return { closed, updated };
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'OPEN');
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values()).sort((a, b) => b.entryTime - a.entryTime);
  }

  getOpenCount(): number {
    return this.getOpenPositions().length;
  }

  getOpenExposure(): number {
    return this.getOpenPositions().reduce((s, p) => s + p.cost, 0);
  }

  getTotalUnrealizedPnl(): number {
    return this.getOpenPositions().reduce((s, p) => s + p.unrealizedPnl, 0);
  }

  getTotalRealizedPnl(): number {
    return Array.from(this.positions.values())
      .filter(p => p.status === 'CLOSED')
      .reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  }

  /** Remove very old closed positions to prevent unbounded growth. */
  pruneOldClosed(maxKeep = 200) {
    const closed = Array.from(this.positions.values())
      .filter(p => p.status === 'CLOSED')
      .sort((a, b) => (b.closeTime ?? 0) - (a.closeTime ?? 0));
    if (closed.length > maxKeep) {
      for (const p of closed.slice(maxKeep)) {
        this.positions.delete(p.id);
      }
    }
  }
}
