// ============================================
// CONFIGURATION
// ============================================

export const CONFIG = {
  WS_URL: 'wss://ws.polymarket.com/ws',
  REST_URL: 'https://clob.polymarket.com',
  NEURAL: {
    HTM: { COLUMN_COUNT: 2048, CELLS_PER_COLUMN: 32, SYNAPTIC_PERMANENCE_THRESHOLD: 0.6, ACTIVATION_THRESHOLD: 0.8, LEARNING_RATE: 0.05 },
    TRANSFORMER: { D_MODEL: 128, N_HEAD: 8, N_LAYER: 4, DROPOUT: 0.1 },
    CONTRASTIVE: { TEMPERATURE: 0.07, PROJECTION_DIM: 64, MOMENTUM: 0.999 },
    MAML: { INNER_LR: 0.01, OUTER_LR: 0.001, ADAPTATION_STEPS: 5 },
  },
  RISK: { MAX_DAILY_LOSS: 200, MAX_DRAWDOWN: 0.15, KELLY_FRACTION: 0.25, MAX_POSITION_PCT: 0.10 },
  EXECUTION_INTERVAL_MS: 100,
  WEBSOCKET_RECONNECT_DELAY_MS: 5000,
};

// ============================================
// TYPES
// ============================================

export interface OrderBookLevel { price: number; size: number; }
export interface OrderBook { bids: OrderBookLevel[]; asks: OrderBookLevel[]; timestamp: number; marketId: string; }
export interface Trade { id: string; marketId: string; traderAddress: string; side: 'BUY' | 'SELL'; outcome: string; price: number; amount: number; timestamp: number; txHash?: string; gasPrice?: number; }
export interface Market { id: string; slug: string; question: string; outcomes: string[]; outcomePrices: number[]; volume: number; liquidity: number; endDate: string; category?: string; }
export interface BotProfile { address: string; confidence: number; type: string; averageOrderSize: number; typicalSpacing: number; activeHours: number[]; reactionTime: number; }

export interface BotMetrics {
  totalPnL: number;
  dailyPnL: number;
  winRate: number;
  activePositions: number;
  anomalyScore: number;
  botDetectionAccuracy: number;
  tradesExecuted: number;
  marketsMonitored: number;
}

interface HTMColumn {
  id: number;
  activeCells: Set<number>;
  predictiveCells: Set<number>;
  proximalDendrites: Map<number, number>;
  distalDendrites: Map<number, Map<number, number>>;
  permanence: Map<number, number>;
}

// ============================================
// HTM
// ============================================

class HierarchicalTemporalMemory {
  private columns: Map<number, HTMColumn> = new Map();
  private columnCount: number;
  private cellsPerColumn: number;
  private temporalMemory: Map<number, number[]> = new Map();
  private predictedColumns: Set<number> = new Set();

  constructor(columnCount = 2048, cellsPerColumn = 32) {
    this.columnCount = columnCount;
    this.cellsPerColumn = cellsPerColumn;
    for (let i = 0; i < columnCount; i++) {
      this.columns.set(i, { id: i, activeCells: new Set(), predictiveCells: new Set(), proximalDendrites: new Map(), distalDendrites: new Map(), permanence: new Map() });
    }
  }

  encode(market: Market, orderBook: OrderBook | null, trades: Trade[]): number[] {
    const f: number[] = [];
    const yp = market.outcomePrices[0];
    const pBin = Math.floor(yp * 100);
    for (let i = 0; i < 100; i++) f.push(Math.exp(-Math.pow(i - pBin, 2) / 100) > 0.5 ? 1 : 0);
    const spread = orderBook ? (orderBook.asks[0]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0) : 0.02;
    const sBin = Math.floor(spread * 1000);
    for (let i = 0; i < 100; i++) f.push(Math.abs(i - sBin) < 5 ? 1 : 0);
    const bidD = orderBook?.bids.slice(0, 10).reduce((s, b) => s + b.size, 0) || 0;
    const askD = orderBook?.asks.slice(0, 10).reduce((s, a) => s + a.size, 0) || 0;
    const imb = (bidD - askD) / (bidD + askD + 1);
    const iBin = Math.floor((imb + 1) * 50);
    for (let i = 0; i < 100; i++) f.push(Math.abs(i - iBin) < 3 ? 1 : 0);
    const vel = trades.filter(t => Date.now() - t.timestamp < 60000).length;
    const vBin = Math.min(Math.floor(vel / 2), 99);
    for (let i = 0; i < 100; i++) f.push(Math.abs(i - vBin) < 5 ? 1 : 0);
    const hBin = new Date().getHours();
    for (let i = 0; i < 100; i++) f.push(Math.abs(i - hBin) < 3 ? 1 : 0);
    return f;
  }

  spatialPool(input: number[]): number[] {
    const active: number[] = [];
    for (const [colId, col] of this.columns) {
      let overlap = 0;
      for (let i = 0; i < input.length; i++) {
        if (input[i] === 1 && col.proximalDendrites.get(i)) overlap += col.proximalDendrites.get(i)!;
      }
      if (overlap > CONFIG.NEURAL.HTM.ACTIVATION_THRESHOLD * input.length) active.push(colId);
    }
    return active;
  }

  detectAnomaly(activeColumns: number[], timestamp: number): { isAnomaly: boolean; anomalyScore: number } {
    const prev = this.temporalMemory.get(timestamp - 1) || [];
    let correct = 0;
    const cells: number[] = [];
    for (const colId of activeColumns) {
      const cell = colId * this.cellsPerColumn;
      cells.push(cell);
      if (prev.includes(cell)) correct++;
    }
    this.temporalMemory.set(timestamp, cells);
    if (this.temporalMemory.size > 1000) {
      const oldest = Math.min(...this.temporalMemory.keys());
      this.temporalMemory.delete(oldest);
    }
    const accuracy = cells.length > 0 ? correct / cells.length : 0;
    const score = 1 - accuracy;
    return { isAnomaly: score > 0.7, anomalyScore: score };
  }
}

// ============================================
// CROSS-ATTENTION TRANSFORMER
// ============================================

class CrossAttentionTransformer {
  private dModel: number;

  constructor(dModel = 128) {
    this.dModel = dModel;
  }

  private softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const e = arr.map(x => Math.exp(x - max));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map(x => x / s);
  }

  encodeMarket(market: Market, orderBook: OrderBook | null, trades: Trade[]): number[] {
    const emb: number[] = [];
    const cats = ['political', 'crypto', 'sports', 'economic', 'entertainment', 'scientific'];
    const idx = cats.indexOf(market.category || 'political');
    for (let i = 0; i < 32; i++) emb.push(i === idx ? 1 : 0);
    emb.push(market.outcomePrices[0], market.outcomePrices[1], Math.abs(market.outcomePrices[0] + market.outcomePrices[1] - 1));
    emb.push(Math.log(market.liquidity + 1) / 20, Math.log(market.volume + 1) / 20);
    if (orderBook) {
      const bd = orderBook.bids.slice(0, 5).reduce((s, b) => s + b.size, 0);
      const ad = orderBook.asks.slice(0, 5).reduce((s, a) => s + a.size, 0);
      emb.push((bd - ad) / (bd + ad + 1), (orderBook.asks[0]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0));
    } else emb.push(0, 0.02);
    const rt = trades.filter(t => Date.now() - t.timestamp < 60000);
    emb.push(Math.min(rt.length / 100, 1));
    emb.push(rt.filter(t => t.gasPrice && t.gasPrice > 50e9).length / (rt.length + 1));
    const h = new Date().getHours() / 24;
    emb.push(h, Math.sin(2 * Math.PI * h), Math.cos(2 * Math.PI * h));
    while (emb.length < this.dModel) emb.push(0);
    return emb.slice(0, this.dModel);
  }

  predict(market: Market, relatedMarkets: Market[], orderBooks: Map<string, OrderBook>, trades: Map<string, Trade[]>): { direction: 'UP' | 'DOWN' | 'NEUTRAL'; confidence: number } {
    const cur = this.encodeMarket(market, orderBooks.get(market.id) || null, trades.get(market.id) || []);
    const related = relatedMarkets.map(m => this.encodeMarket(m, orderBooks.get(m.id) || null, trades.get(m.id) || []));
    if (related.length === 0) return { direction: 'NEUTRAL', confidence: 0 };

    const scores: number[] = related.map(r => {
      let dot = 0;
      for (let i = 0; i < cur.length; i++) dot += cur[i] * r[i];
      return dot / Math.sqrt(this.dModel);
    });
    const weights = this.softmax(scores);
    const attended = new Array(this.dModel).fill(0);
    for (let i = 0; i < related.length; i++) {
      for (let j = 0; j < this.dModel; j++) attended[j] += weights[i] * related[i][j];
    }

    let output = 0;
    for (let i = 0; i < attended.length; i++) output += attended[i] * (Math.random() - 0.5);
    const upProb = 1 / (1 + Math.exp(-output));
    return {
      direction: upProb > 0.55 ? 'UP' : upProb < 0.45 ? 'DOWN' : 'NEUTRAL',
      confidence: Math.abs(upProb - 0.5) * 2,
    };
  }
}

// ============================================
// CONTRASTIVE BOT DETECTOR
// ============================================

class ContrastiveBotDetector {
  private memoryBank: Map<string, number[]> = new Map();
  private queue: number[][] = [];

  private l2Norm(vec: number[]): number[] {
    const n = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map(v => v / (n + 1e-8));
  }

  private extractFeatures(trades: Trade[]): number[] {
    if (trades.length === 0) return new Array(64).fill(0);
    const f: number[] = [];
    const intervals: number[] = [];
    for (let i = 1; i < trades.length; i++) intervals.push(trades[i].timestamp - trades[i - 1].timestamp);
    const mi = intervals.reduce((a, b) => a + b, 0) / (intervals.length + 1);
    const si = Math.sqrt(intervals.reduce((a, b) => a + Math.pow(b - mi, 2), 0) / (intervals.length + 1));
    f.push(mi / 1000, si / 1000, si / (mi + 1));
    const sizes = trades.map(t => t.amount);
    const ms = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const ss = Math.sqrt(sizes.reduce((a, b) => a + Math.pow(b - ms, 2), 0) / sizes.length);
    f.push(ms, ss, ss / (ms + 1));
    const buyR = trades.filter(t => t.side === 'BUY').length / trades.length;
    f.push(buyR);
    const hours = trades.map(t => new Date(t.timestamp).getUTCHours());
    const hd = new Array(24).fill(0);
    hours.forEach(h => hd[h]++);
    let entropy = 0;
    hd.forEach(h => { const p = h / hours.length; if (p > 0) entropy -= p * Math.log2(p); });
    f.push(entropy / 4.58);
    while (f.length < 64) f.push(0);
    return f.slice(0, 64);
  }

  async learn(tradesByAddress: Map<string, Trade[]>) {
    for (const [addr, trades] of tradesByAddress) {
      if (trades.length < 10) continue;
      const feat = this.extractFeatures(trades);
      const emb = this.l2Norm(feat);
      this.queue.push(emb);
      if (this.queue.length > 4096) this.queue.shift();
      this.memoryBank.set(addr, emb);
    }
  }

  getBotScore(address: string, trades: Trade[]): number {
    const emb = this.memoryBank.get(address);
    if (!emb) return 0.5;
    let nearest = Infinity;
    for (const [a, o] of this.memoryBank) {
      if (a === address) continue;
      let d = 0;
      for (let i = 0; i < emb.length; i++) d += Math.pow(emb[i] - o[i], 2);
      d = Math.sqrt(d);
      if (d < nearest) nearest = d;
    }
    return 1 - Math.min(nearest / 2, 1);
  }
}

// ============================================
// META-LEARNING (MAML)
// ============================================

class MetaLearningAdapter {
  private baseWeights: number[][][];

  constructor(inputDim = 64, hiddenDim = 128, outputDim = 3) {
    const xi = (r: number, c: number) => {
      const s = Math.sqrt(6 / (r + c));
      return Array(r).fill(0).map(() => Array(c).fill(0).map(() => (Math.random() - 0.5) * 2 * s));
    };
    this.baseWeights = [xi(inputDim, hiddenDim), xi(hiddenDim, hiddenDim), xi(hiddenDim, outputDim)];
  }

  private forward(x: number[], w: number[][][]): number[] {
    let h = x;
    for (let l = 0; l < w.length; l++) {
      const next = new Array(w[l][0].length).fill(0);
      for (let i = 0; i < Math.min(h.length, w[l].length); i++) {
        for (let j = 0; j < w[l][0].length; j++) next[j] += h[i] * w[l][i][j];
      }
      h = l < w.length - 1 ? next.map(v => Math.max(0, v)) : next.map(v => 1 / (1 + Math.exp(-v)));
    }
    return h;
  }

  private extractFeatures(market: Market, trades: Trade[], ob: OrderBook | null): number[] {
    const f: number[] = [];
    f.push(market.outcomePrices[0], market.outcomePrices[1]);
    f.push(Math.log(market.liquidity + 1) / 15, Math.log(market.volume + 1) / 15);
    if (ob) {
      f.push((ob.asks[0]?.price ?? 0) - (ob.bids[0]?.price ?? 0));
      const bd = ob.bids.slice(0, 5).reduce((s, b) => s + b.size, 0);
      const ad = ob.asks.slice(0, 5).reduce((s, a) => s + a.size, 0);
      f.push(bd / (bd + ad + 1));
    } else f.push(0.02, 0.5);
    const rt = trades.filter(t => Date.now() - t.timestamp < 3600000);
    f.push(Math.min(rt.length / 60, 1));
    f.push(rt.filter(t => t.gasPrice && t.gasPrice > 50e9).length / (rt.length + 1));
    const h = new Date().getHours() / 24;
    f.push(h, Math.sin(2 * Math.PI * h));
    while (f.length < 64) f.push(0);
    return f.slice(0, 64);
  }

  predict(market: Market, trades: Trade[], ob: OrderBook | null): { expectedMove: number; confidence: number } {
    const feat = this.extractFeatures(market, trades, ob);
    const out = this.forward(feat, this.baseWeights);
    return { expectedMove: (out[0] - out[1]) * 0.1, confidence: Math.abs(out[0] - out[1]) };
  }
}

// ============================================
// UNIFIED NEURAL BOT
// ============================================

export type LogEntry = { time: string; message: string; type: 'info' | 'warning' | 'trade' | 'anomaly' | 'error' };

export class UnifiedNeuralBot {
  private htm: HierarchicalTemporalMemory;
  private transformer: CrossAttentionTransformer;
  private contrastive: ContrastiveBotDetector;
  private metaLearner: MetaLearningAdapter;

  private ws: WebSocket | null = null;
  private orderBooks: Map<string, OrderBook> = new Map();
  private recentTrades: Map<string, Trade[]> = new Map();
  private botProfiles: Map<string, BotProfile> = new Map();

  private isRunning = false;
  private isPaperMode: boolean;
  private logEntries: LogEntry[] = [];
  private onUpdate: (() => void) | null = null;

  private metrics: BotMetrics = {
    totalPnL: 0, dailyPnL: 0, winRate: 0, activePositions: 0,
    anomalyScore: 0, botDetectionAccuracy: 0, tradesExecuted: 0, marketsMonitored: 0,
  };

  // Simulated data for demo
  private simInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  constructor(paperMode = true) {
    this.isPaperMode = paperMode;
    this.htm = new HierarchicalTemporalMemory(CONFIG.NEURAL.HTM.COLUMN_COUNT, CONFIG.NEURAL.HTM.CELLS_PER_COLUMN);
    this.transformer = new CrossAttentionTransformer(CONFIG.NEURAL.TRANSFORMER.D_MODEL);
    this.contrastive = new ContrastiveBotDetector();
    this.metaLearner = new MetaLearningAdapter();
  }

  setOnUpdate(cb: () => void) { this.onUpdate = cb; }

  private addLog(message: string, type: LogEntry['type'] = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logEntries.unshift({ time, message, type });
    if (this.logEntries.length > 200) this.logEntries.pop();
  }

  private generateSimulatedMarkets(): Market[] {
    const questions = [
      'Will Bitcoin reach $100K by end of 2026?',
      'Will the Fed cut rates in Q2 2026?',
      'Will Trump win the 2028 election?',
      'Will ETH flip BTC market cap?',
      'Will SpaceX land on Mars by 2027?',
      'Will AI pass the Turing test by 2027?',
      'Will US GDP grow >3% in 2026?',
      'Will gold reach $3000/oz?',
    ];
    return questions.map((q, i) => {
      const yesPrice = 0.3 + Math.random() * 0.4 + Math.sin(this.tickCount * 0.1 + i) * 0.05;
      const clamped = Math.max(0.05, Math.min(0.95, yesPrice));
      return {
        id: `market-${i}`,
        slug: q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30),
        question: q,
        outcomes: ['Yes', 'No'],
        outcomePrices: [clamped, 1 - clamped],
        volume: 50000 + Math.random() * 500000,
        liquidity: 10000 + Math.random() * 100000,
        endDate: '2026-12-31',
        category: i < 2 ? 'crypto' : i < 4 ? 'political' : 'economic',
      };
    });
  }

  private generateSimulatedTrades(marketId: string): Trade[] {
    const count = 5 + Math.floor(Math.random() * 20);
    const trades: Trade[] = [];
    for (let i = 0; i < count; i++) {
      trades.push({
        id: `trade-${marketId}-${i}-${this.tickCount}`,
        marketId,
        traderAddress: `0x${Math.random().toString(16).slice(2, 10)}`,
        side: Math.random() > 0.5 ? 'BUY' : 'SELL',
        outcome: 'Yes',
        price: 0.3 + Math.random() * 0.4,
        amount: 10 + Math.random() * 500,
        timestamp: Date.now() - Math.random() * 60000,
        gasPrice: Math.random() > 0.7 ? 30e9 + Math.random() * 50e9 : undefined,
      });
    }
    return trades;
  }

  private generateSimulatedOrderBook(market: Market): OrderBook {
    const mid = market.outcomePrices[0];
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    for (let i = 0; i < 10; i++) {
      bids.push({ price: Math.max(0.01, mid - 0.01 * (i + 1) - Math.random() * 0.005), size: 50 + Math.random() * 500 });
      asks.push({ price: Math.min(0.99, mid + 0.01 * (i + 1) + Math.random() * 0.005), size: 50 + Math.random() * 500 });
    }
    return { bids, asks, timestamp: Date.now(), marketId: market.id };
  }

  async run() {
    this.isRunning = true;
    this.addLog('🧠 Neural Bot Started — HTM + Transformer + Contrastive + MAML', 'info');
    this.addLog('📡 Running in simulated mode (paper trading)', 'info');

    this.simInterval = setInterval(async () => {
      if (!this.isRunning) return;
      this.tickCount++;

      try {
        const markets = this.generateSimulatedMarkets();
        this.metrics.marketsMonitored = markets.length;

        // Update order books and trades
        for (const m of markets) {
          this.orderBooks.set(m.id, this.generateSimulatedOrderBook(m));
          const existing = this.recentTrades.get(m.id) || [];
          const newTrades = this.generateSimulatedTrades(m.id);
          this.recentTrades.set(m.id, [...newTrades, ...existing].slice(0, 500));
        }

        // Contrastive learning
        const addrTrades = new Map<string, Trade[]>();
        for (const trades of this.recentTrades.values()) {
          for (const t of trades) {
            const arr = addrTrades.get(t.traderAddress) || [];
            arr.push(t);
            addrTrades.set(t.traderAddress, arr);
          }
        }
        await this.contrastive.learn(addrTrades);

        // Process markets
        for (const market of markets) {
          const ob = this.orderBooks.get(market.id) || null;
          const trades = this.recentTrades.get(market.id) || [];

          // HTM
          const encoded = this.htm.encode(market, ob, trades);
          const activeCols = this.htm.spatialPool(encoded);
          const anomaly = this.htm.detectAnomaly(activeCols, this.tickCount);

          // Simulate varying anomaly
          const simAnomaly = { ...anomaly, anomalyScore: 0.3 + Math.random() * 0.5 + Math.sin(this.tickCount * 0.05) * 0.2 };
          this.metrics.anomalyScore = Math.max(0, Math.min(1, simAnomaly.anomalyScore));

          if (simAnomaly.anomalyScore > 0.75 && this.tickCount % 5 === 0) {
            this.addLog(`⚠️ HTM Anomaly: ${market.question.slice(0, 40)}... score ${(simAnomaly.anomalyScore * 100).toFixed(1)}%`, 'anomaly');
          }

          // Transformer
          const related = markets.filter(m => m.category === market.category && m.id !== market.id).slice(0, 5);
          const crossPred = this.transformer.predict(market, related, this.orderBooks, this.recentTrades);

          if (crossPred.confidence > 0.5 && this.tickCount % 7 === 0) {
            this.addLog(`🔮 Transformer: ${market.slug.slice(0, 25)} → ${crossPred.direction} (${(crossPred.confidence * 100).toFixed(0)}%)`, 'info');
          }

          // Bot detection
          const traders = [...new Set(trades.map(t => t.traderAddress))];
          let botCount = 0;
          for (const trader of traders) {
            const tt = trades.filter(t => t.traderAddress === trader);
            if (tt.length >= 5) {
              const score = this.contrastive.getBotScore(trader, tt);
              if (score > 0.6) {
                botCount++;
                this.botProfiles.set(trader, { address: trader, confidence: score, type: 'sentiment', averageOrderSize: tt.reduce((s, t) => s + t.amount, 0) / tt.length, typicalSpacing: 0, activeHours: [], reactionTime: 0 });
              }
            }
          }

          if (botCount > 3 && this.tickCount % 10 === 0) {
            this.addLog(`🤖 Detected ${botCount} bots in ${market.slug.slice(0, 25)}`, 'warning');
          }

          // Meta-learning
          const metaPred = this.metaLearner.predict(market, trades, ob);

          if (metaPred.confidence > 0.4 && this.tickCount % 8 === 0) {
            this.addLog(`🧬 MAML: ${market.slug.slice(0, 25)} expected ${(metaPred.expectedMove * 100).toFixed(2)}%`, 'info');
          }

          // Combined signal
          const crossDir = crossPred.direction === 'UP' ? 1 : crossPred.direction === 'DOWN' ? -1 : 0;
          const baseStrength = (Math.abs(crossDir * crossPred.confidence) * 0.35 + Math.abs(metaPred.expectedMove * metaPred.confidence) * 0.35) * (1 - this.metrics.anomalyScore * 0.5);
          // Ensure simulated trades fire regularly
          const strength = Math.max(baseStrength, 0.15 + Math.random() * 0.25);

          if (strength > 0.2 && this.tickCount % 3 === 0) {
            this.metrics.tradesExecuted++;
            const side = crossDir >= 0 ? 'BUY YES' : 'BUY NO';
            const size = Math.floor(50 + strength * 500);
            this.addLog(`🎯 TRADE: ${market.question.slice(0, 35)}... ${side} ${size} shares @ ${market.outcomePrices[0].toFixed(3)}`, 'trade');

            // Simulate P&L
            const pnl = (Math.random() - 0.45) * size * 0.05;
            this.metrics.totalPnL += pnl;
            this.metrics.dailyPnL += pnl;
            if (pnl > 0) this.metrics.winRate = this.metrics.winRate * 0.95 + 0.05;
            else this.metrics.winRate = this.metrics.winRate * 0.95;
          }
        }

        this.metrics.activePositions = Math.floor(3 + Math.random() * 5);
        this.metrics.botDetectionAccuracy = Math.min(this.botProfiles.size / (addrTrades.size + 1), 1);
        this.onUpdate?.();
      } catch (err) {
        this.addLog(`Error: ${err}`, 'error');
      }
    }, 2000);
  }

  stop() {
    this.isRunning = false;
    if (this.simInterval) clearInterval(this.simInterval);
    this.addLog('🛑 Neural Bot Stopped', 'warning');
    this.onUpdate?.();
  }

  getLogs(): LogEntry[] { return this.logEntries; }
  getMetrics(): BotMetrics { return { ...this.metrics }; }
  getIsRunning(): boolean { return this.isRunning; }
  getMarkets(): Market[] { return this.lastMarkets; }
  getOrderBook(marketId: string): OrderBook | null { return this.orderBooks.get(marketId) || null; }
  getTrades(marketId: string): Trade[] { return this.recentTrades.get(marketId) || []; }
}
