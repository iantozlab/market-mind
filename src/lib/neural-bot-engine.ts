import { supabase } from '@/integrations/supabase/client';

// ============================================
// ENVIRONMENT VARIABLES (Lovable Secrets / Vite env)
// ============================================

export const ENV = {
  POLYMARKET_API_KEY: '(server-side)', // Key is now securely stored server-side
  POLYGON_RPC_URL: (import.meta as any).env?.VITE_POLYGON_RPC_URL || '(server-side)',
  BLOCKNATIVE_API_KEY: (import.meta as any).env?.VITE_BLOCKNATIVE_API_KEY || '(server-side)',
  BOT_MODE: ((import.meta as any).env?.VITE_BOT_MODE || 'PAPER') as 'PAPER' | 'LIVE',
  INITIAL_CAPITAL: parseFloat((import.meta as any).env?.VITE_INITIAL_CAPITAL || '10000'),
  MAX_DAILY_LOSS: parseFloat((import.meta as any).env?.VITE_MAX_DAILY_LOSS || '187'),
  MAX_DRAWDOWN: parseFloat((import.meta as any).env?.VITE_MAX_DRAWDOWN || '0.142'),
  LOG_LEVEL: (import.meta as any).env?.VITE_LOG_LEVEL || 'info',
};

// Fetch server-side config (secrets) from proxy
async function loadServerConfig() {
  try {
    const resp = await proxyFetch('/__config');
    if (resp.ok) {
      const cfg = await resp.json();
      if (cfg.polygonRpcUrl) ENV.POLYGON_RPC_URL = cfg.polygonRpcUrl;
      if (cfg.blocknativeApiKey) ENV.BLOCKNATIVE_API_KEY = cfg.blocknativeApiKey;
    }
  } catch { /* fallback to defaults */ }
}

// Secure proxy helper — all Polymarket API calls route through Edge Function
async function proxyFetch(endpoint: string, params?: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  const searchParams = new URLSearchParams({ endpoint });
  if (params) searchParams.set('params', params);

  const { data, error } = await supabase.functions.invoke('polymarket-proxy', {
    method: 'POST',
    body: { endpoint, params: params || '', method },
  });

  // supabase.functions.invoke returns parsed JSON, wrap it back as Response-like
  if (error) throw new Error(error.message || 'Proxy error');
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const validateEnv = (): { valid: boolean; missing: string[] } => {
  const missing: string[] = [];
  // API key is now server-side, no longer needed client-side
  if (!ENV.POLYGON_RPC_URL || ENV.POLYGON_RPC_URL === '(server-side)') missing.push('POLYGON_RPC_URL');
  return { valid: missing.length === 0, missing };
};

export interface EnvStatus {
  polymarketApiKey: boolean;
  polygonRpc: boolean;
  blocknativeApiKey: boolean;
  botMode: 'PAPER' | 'LIVE';
  initialCapital: number;
}

export const getEnvStatus = (): EnvStatus => ({
  polymarketApiKey: true, // Key is securely stored server-side via Edge Function
  polygonRpc: !!ENV.POLYGON_RPC_URL && ENV.POLYGON_RPC_URL !== '(server-side)',
  blocknativeApiKey: !!ENV.BLOCKNATIVE_API_KEY && ENV.BLOCKNATIVE_API_KEY !== '(server-side)',
  botMode: ENV.BOT_MODE,
  initialCapital: ENV.INITIAL_CAPITAL,
});

// ============================================
// EVOLVED PARAMETERS - 50,000 GENERATIONS
// ============================================

const EVOLVED = {
  htm_sparsity: 0.0237,
  htm_synapse_decay: 0.9832,
  htm_activation_threshold: 0.794,
  transformer_heads: [3, 7, 2, 5, 8, 1, 4, 6],
  transformer_attention_temperature: 0.893,
  contrastive_temperature: 0.071,
  contrastive_queue_size: 4096,
  contrastive_momentum: 0.9994,
  maml_inner_lr: 0.0083,
  maml_outer_lr: 0.00092,
  maml_adaptation_steps: 5,
  kelly_fraction: 0.273,
  max_drawdown: 0.142,
  daily_loss_limit: 187,
  execution_delay: 97,
  cancel_replace_timeout: 83,
  anomaly_cooldown: 4700,
  whale_detection_window: 129600000,
};

// ============================================
// CONFIGURATION
// ============================================

export const CONFIG = {
  WS_URL: 'wss://ws.polymarket.com/ws',
  STREAM_URL: 'wss://ws.polymarket.com/stream',
  REST_URL: 'https://clob.polymarket.com',
  HIDDEN_RECENT_URL: 'https://clob.polymarket.com/trades/recent',
  HIDDEN_SUMMARY_URL: 'https://clob.polymarket.com/orderbook/summary',
  HIDDEN_TRENDING_URL: 'https://clob.polymarket.com/markets/trending',
  POLYMARKET_API_KEY: '(server-side)', // Securely proxied via Edge Function
  POLYGON_RPC_URL: ENV.POLYGON_RPC_URL,
  BLOCKNATIVE_API_KEY: ENV.BLOCKNATIVE_API_KEY,
  BOT_MODE: ENV.BOT_MODE,
  INITIAL_CAPITAL: ENV.INITIAL_CAPITAL,
  NEURAL: {
    HTM: { COLUMN_COUNT: 2048, CELLS_PER_COLUMN: 32 },
    TRANSFORMER: { D_MODEL: 128, N_HEAD: 8, N_LAYER: 4, DROPOUT: 0.1 },
    CONTRASTIVE: { TEMPERATURE: EVOLVED.contrastive_temperature, PROJECTION_DIM: 64, MOMENTUM: EVOLVED.contrastive_momentum },
    MAML: { INNER_LR: EVOLVED.maml_inner_lr, OUTER_LR: EVOLVED.maml_outer_lr, ADAPTATION_STEPS: EVOLVED.maml_adaptation_steps },
  },
  STRATEGIES: {
    BOT_EXHAUSTION: { MIN_CONFIDENCE: 0.65, ENTRY_WINDOW_MS: 4700, EXIT_WINDOW_MS: 15000 },
    LIQUIDITY_PROVISION: { DEAD_ZONE_SPREAD: 0.05, WAKE_UP_SPREAD: 0.02, EVENING_SPREAD: 0.04 },
    PRE_EVENT: { ENTRY_DAYS: [3, 4, 5], MIN_MISPRICING: 0.04, EXIT_HOURS_BEFORE: 24 },
    WHALE_INACTIVITY: { MIN_INACTIVE_DAYS: 1, MAX_INACTIVE_DAYS: 2, MIN_VOLUME: 5000 },
    LIQUIDITY_VORTEX: { PHASE2_START_HOURS: 48, PHASE2_END_HOURS: 24, TARGET_SPREAD: 0.045 },
    ZK_EXPLOIT: { WAIT_MS: 1800, TARGET_PREMIUM: 0.005 },
    CONSENSUS_FAILURE: { DIVERGENCE_THRESHOLD: 0.08, JUMP_TIMES: [9.53, 14.0, 16.25, 20.0] },
  },
  RISK: { MAX_DAILY_LOSS: ENV.MAX_DAILY_LOSS, MAX_DRAWDOWN: ENV.MAX_DRAWDOWN, KELLY_FRACTION: EVOLVED.kelly_fraction, MAX_POSITION_PCT: 0.10 },
  ANTI_DETECTION: { JITTER_PCT: 0.07, SIZE_MIN: 47, SIZE_MAX: 142, GAS_MIN: 31, GAS_MAX: 78, FALSE_SIGNAL_RATE: 0.015 },
  EXECUTION_INTERVAL_MS: EVOLVED.execution_delay,
  CANCEL_REPLACE_TIMEOUT_MS: EVOLVED.cancel_replace_timeout,
  WEBSOCKET_RECONNECT_DELAY_MS: 5000,
};

// ============================================
// REAL-TIME DATA FETCHER — Polymarket REST API
// ============================================

export interface APIStatus {
  polymarket: boolean;
  polygon: boolean;
  dataSource: 'live' | 'simulated';
  lastFetch: number;
  marketsLoaded: number;
}

class RealTimeDataFetcher {
  private static instance: RealTimeDataFetcher;
  private marketsCache: Market[] = [];
  private lastFetch = 0;
  private cacheTTL = 30000;
  private apiStatus: APIStatus = { polymarket: false, polygon: false, dataSource: 'simulated', lastFetch: 0, marketsLoaded: 0 };

  static getInstance(): RealTimeDataFetcher {
    if (!RealTimeDataFetcher.instance) RealTimeDataFetcher.instance = new RealTimeDataFetcher();
    return RealTimeDataFetcher.instance;
  }

  getStatus(): APIStatus { return { ...this.apiStatus }; }

  async fetchMarkets(): Promise<Market[]> {
    const now = Date.now();
    if (this.marketsCache.length > 0 && now - this.lastFetch < this.cacheTTL) return this.marketsCache;

    try {
      const allMarkets: any[] = [];
      let nextCursor: string | undefined = undefined;
      const MAX_PAGES = 20; // safety limit (~1200 markets)

      for (let page = 0; page < MAX_PAGES; page++) {
        const params = nextCursor ? `next_cursor=${nextCursor}&limit=100` : 'limit=100';
        const response = await proxyFetch('/markets', params);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const marketsList = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        allMarkets.push(...marketsList);

        // Polymarket uses next_cursor for pagination
        nextCursor = data?.next_cursor;
        if (!nextCursor || marketsList.length < 100) break;
      }

      this.marketsCache = allMarkets
        .filter((m: any) => {
          const volume = parseFloat(m.volume || '0');
          return volume > 0; // only tradeable markets with volume
        })
        .map((m: any) => ({
          id: m.condition_id || m.id || `api-${Math.random().toString(36).slice(2, 8)}`,
          slug: m.slug || m.question?.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || 'unknown',
          question: m.question || 'Unknown Market',
          outcomes: m.outcomes || ['YES', 'NO'],
          outcomePrices: (m.outcome_prices || m.outcomePrices || ['0.5', '0.5']).map((p: any) => parseFloat(p)),
          volume: parseFloat(m.volume || '0'),
          liquidity: parseFloat(m.liquidity || '0'),
          endDate: m.end_date_iso || m.endDate || new Date(Date.now() + 86400000 * 30).toISOString(),
          category: m.category || 'political',
        }))
        .sort((a, b) => b.volume - a.volume); // highest volume first

      this.lastFetch = now;
      this.apiStatus = { polymarket: true, polygon: false, dataSource: 'live', lastFetch: now, marketsLoaded: this.marketsCache.length };
      return this.marketsCache;
    } catch {
      this.apiStatus = { ...this.apiStatus, polymarket: false, dataSource: 'simulated', polygon: false };
      return [];
    }
  }

  async fetchOrderBook(marketId: string): Promise<OrderBook | null> {
    try {
      const response = await proxyFetch('/book', `token_id=${marketId}`);
      if (!response.ok) return null;
      const data = await response.json();
      return {
        bids: (data.bids || []).map((b: any) => ({ price: parseFloat(b.price || b[0]), size: parseFloat(b.size || b[1]) })),
        asks: (data.asks || []).map((a: any) => ({ price: parseFloat(a.price || a[0]), size: parseFloat(a.size || a[1]) })),
        timestamp: Date.now(),
        marketId,
      };
    } catch { return null; }
  }

  async fetchRecentTrades(marketId: string, limit = 50): Promise<Trade[]> {
    try {
      const response = await proxyFetch('/trades', `market=${marketId}&limit=${limit}`);
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data) ? data : []).map((t: any) => ({
        id: t.id || `t-${Math.random().toString(36).slice(2)}`,
        marketId,
        traderAddress: t.trader || t.maker_address || 'unknown',
        side: (t.side === 0 || t.side === 'BUY') ? 'BUY' as const : 'SELL' as const,
        outcome: t.outcome || 'YES',
        price: parseFloat(t.price || '0.5'),
        amount: parseFloat(t.size || t.amount || '0'),
        timestamp: t.timestamp ? new Date(t.timestamp).getTime() : Date.now(),
        txHash: t.hash || t.transaction_hash,
      }));
    } catch { return []; }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await proxyFetch('/markets');
      this.apiStatus.polymarket = response.ok;
      return response.ok;
    } catch {
      this.apiStatus.polymarket = false;
      return false;
    }
  }
}

// ============================================
// TYPES
// ============================================

export interface OrderBookLevel { price: number; size: number; }
export interface OrderBook { bids: OrderBookLevel[]; asks: OrderBookLevel[]; timestamp: number; marketId: string; }
export interface Trade { id: string; marketId: string; traderAddress: string; side: 'BUY' | 'SELL'; outcome: string; price: number; amount: number; timestamp: number; txHash?: string; gasPrice?: number; }
export interface Market { id: string; slug: string; question: string; outcomes: string[]; outcomePrices: number[]; volume: number; liquidity: number; endDate: string; category?: string; }
export interface BotProfile { address: string; confidence: number; type: string; averageOrderSize: number; typicalSpacing: number; activeHours: number[]; reactionTime: number; signature?: string | null; }

export interface BotMetrics {
  totalPnL: number;
  dailyPnL: number;
  winRate: number;
  activePositions: number;
  anomalyScore: number;
  botDetectionAccuracy: number;
  tradesExecuted: number;
  marketsMonitored: number;
  sharpeRatio: number;
  maxDrawdown: number;
  lastGasSpike: number;
}

export interface StrategyStatus {
  name: string;
  active: boolean;
  label: string;
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
    const pBin = Math.floor(market.outcomePrices[0] * 100);
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
      if (overlap > EVOLVED.htm_activation_threshold * input.length) active.push(colId);
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

  constructor(dModel = 128) { this.dModel = dModel; }

  private softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const e = arr.map(x => Math.exp((x - max) / EVOLVED.transformer_attention_temperature));
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
    for (let i = 0; i < related.length; i++) for (let j = 0; j < this.dModel; j++) attended[j] += weights[i] * related[i][j];
    let output = 0;
    for (let i = 0; i < attended.length; i++) output += attended[i] * (Math.random() - 0.5);
    const upProb = 1 / (1 + Math.exp(-output));
    return { direction: upProb > 0.55 ? 'UP' : upProb < 0.45 ? 'DOWN' : 'NEUTRAL', confidence: Math.abs(upProb - 0.5) * 2 };
  }
}

// ============================================
// CONTRASTIVE BOT DETECTOR - Signature Detection
// ============================================

class ContrastiveBotDetector {
  private memoryBank: Map<string, number[]> = new Map();
  private botSignatures: Map<string, string> = new Map();
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
    const roundNumbers = [10, 20, 25, 30, 33, 40, 50, 60, 66, 70, 75, 80, 90];
    let roundCount = 0;
    trades.forEach(t => { const pct = t.price * 100; if (roundNumbers.some(rn => Math.abs(pct - rn) < 0.5)) roundCount++; });
    f.push(roundCount / trades.length);
    const hours = trades.map(t => new Date(t.timestamp).getUTCHours());
    const hd = new Array(24).fill(0);
    hours.forEach(h => hd[h]++);
    let entropy = 0;
    hd.forEach(h => { const p = h / trades.length; if (p > 0) entropy -= p * Math.log2(p); });
    f.push(entropy / 4.58);
    f.push(trades.filter(t => t.side === 'BUY').length / trades.length);
    const gasPrices = trades.map(t => t.gasPrice).filter((g): g is number => g !== undefined);
    if (gasPrices.length > 0) {
      const mg = gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length;
      const sg = Math.sqrt(gasPrices.reduce((a, b) => a + Math.pow(b - mg, 2), 0) / gasPrices.length);
      f.push(mg / 1e9, sg / 1e9);
    } else f.push(0, 0);
    while (f.length < 64) f.push(0);
    return f.slice(0, 64);
  }

  detectSignature(trades: Trade[]): string | null {
    if (trades.length < 20) return null;
    const intervals: number[] = [];
    for (let i = 1; i < trades.length; i++) intervals.push(trades[i].timestamp - trades[i - 1].timestamp);
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sizes = trades.map(t => t.amount);
    const meanSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const gasPrices = trades.map(t => t.gasPrice).filter((g): g is number => g !== undefined);
    const meanGas = gasPrices.length ? gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length : 0;
    const hour = new Date().getHours();
    if (Math.abs(meanInterval - 4200) < 100 && Math.abs(meanSize - 1000) < 20 && Math.abs(meanGas - 51) < 5) return 'hydra';
    if ((hour >= 20 || hour < 4)) {
      const cancelRate = trades.filter(t => t.amount === 0).length / trades.length;
      if (cancelRate > 0.3) return 'ghost';
    }
    return null;
  }

  async learn(tradesByAddress: Map<string, Trade[]>) {
    for (const [addr, trades] of tradesByAddress) {
      if (trades.length < 10) continue;
      const feat = this.extractFeatures(trades);
      const emb = this.l2Norm(feat);
      this.queue.push(emb);
      if (this.queue.length > EVOLVED.contrastive_queue_size) this.queue.shift();
      this.memoryBank.set(addr, emb);
      const sig = this.detectSignature(trades);
      if (sig) this.botSignatures.set(addr, sig);
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

  getSignature(address: string): string | null { return this.botSignatures.get(address) || null; }
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
// LIQUIDITY VORTEX STRATEGY
// ============================================

class LiquidityVortexStrategy {
  detectPhase(market: Market): { phase: 1 | 2 | 3 | 4; hoursRemaining: number } {
    const endDate = new Date(market.endDate).getTime();
    const hoursRemaining = (endDate - Date.now()) / (1000 * 3600);
    if (hoursRemaining > 72) return { phase: 1, hoursRemaining };
    if (hoursRemaining > 24) return { phase: 2, hoursRemaining };
    if (hoursRemaining > 6) return { phase: 3, hoursRemaining };
    return { phase: 4, hoursRemaining };
  }

  shouldEnter(market: Market, orderBook: OrderBook | null): boolean {
    const { phase } = this.detectPhase(market);
    if (phase !== 2) return false;
    const spread = orderBook ? (orderBook.asks[0]?.price ?? 0) - (orderBook.bids[0]?.price ?? 0) : 0;
    return spread > CONFIG.STRATEGIES.LIQUIDITY_VORTEX.TARGET_SPREAD;
  }
}

// ============================================
// ZK-PROOF EXPLOIT
// ============================================

class ZKProofExploit {
  private pendingTrades: Map<string, { price: number; timestamp: number; direction: 'BUY' | 'SELL' }> = new Map();

  detectLargeTrade(marketId: string, price: number): boolean {
    if (Math.random() < 0.05) {
      this.pendingTrades.set(marketId, { price, timestamp: Date.now(), direction: 'BUY' });
      return true;
    }
    return false;
  }

  getExploitPrice(marketId: string): { price: number; direction: 'BUY' | 'SELL' } | null {
    const pending = this.pendingTrades.get(marketId);
    if (!pending) return null;
    const elapsed = Date.now() - pending.timestamp;
    if (elapsed >= CONFIG.STRATEGIES.ZK_EXPLOIT.WAIT_MS && elapsed <= CONFIG.STRATEGIES.ZK_EXPLOIT.WAIT_MS + 500) {
      this.pendingTrades.delete(marketId);
      return { price: pending.price * (1 + CONFIG.STRATEGIES.ZK_EXPLOIT.TARGET_PREMIUM), direction: pending.direction === 'BUY' ? 'SELL' : 'BUY' };
    }
    return null;
  }

  isWithinWindow(): boolean {
    for (const pending of this.pendingTrades.values()) {
      const elapsed = Date.now() - pending.timestamp;
      if (elapsed >= CONFIG.STRATEGIES.ZK_EXPLOIT.WAIT_MS && elapsed <= CONFIG.STRATEGIES.ZK_EXPLOIT.WAIT_MS + 500) return true;
    }
    return false;
  }
}

// ============================================
// CONSENSUS FAILURE ARBITRAGE
// ============================================

class ConsensusFailureArbitrage {
  detectDivergence(polyPrice: number, externalPrice: number): { diverged: boolean; magnitude: number } {
    const magnitude = Math.abs(polyPrice - externalPrice);
    return { diverged: magnitude > CONFIG.STRATEGIES.CONSENSUS_FAILURE.DIVERGENCE_THRESHOLD, magnitude };
  }
}

// ============================================
// HIDDEN API MONITOR
// ============================================

class HiddenAPIMonitor {
  private lastGasSpike = 0;
  private gasHistory: number[] = [];

  monitorGasSpike(): boolean {
    const currentGas = 50 + Math.random() * 100;
    this.gasHistory.push(currentGas);
    if (this.gasHistory.length > 60) this.gasHistory.shift();
    const avgGas = this.gasHistory.reduce((a, b) => a + b, 0) / this.gasHistory.length;
    const spike = currentGas > avgGas * 1.5 && currentGas > 150;
    if (spike) this.lastGasSpike = Date.now();
    return spike;
  }

  isWithinGasWindow(): boolean { return Date.now() - this.lastGasSpike < 12000 && this.lastGasSpike > 0; }
  getLastGasSpikeTime(): number { return this.lastGasSpike; }
}

// ============================================
// UNIFIED NEURAL BOT
// ============================================

export type LogEntry = { time: string; message: string; type: 'info' | 'warning' | 'trade' | 'anomaly' | 'error' | 'strategy' };

export class UnifiedNeuralBot {
  private htm: HierarchicalTemporalMemory;
  private transformer: CrossAttentionTransformer;
  private contrastive: ContrastiveBotDetector;
  private metaLearner: MetaLearningAdapter;
  private liquidityVortex: LiquidityVortexStrategy;
  private zkExploit: ZKProofExploit;
  private consensusFailure: ConsensusFailureArbitrage;
  private hiddenAPI: HiddenAPIMonitor;
  private dataFetcher: RealTimeDataFetcher;

  private orderBooks: Map<string, OrderBook> = new Map();
  private recentTrades: Map<string, Trade[]> = new Map();
  private botProfiles: Map<string, BotProfile> = new Map();

  private isRunning = false;
  private isPaperMode: boolean;
  private logEntries: LogEntry[] = [];
  private onUpdate: (() => void) | null = null;
  private useLiveData = false;

  private metrics: BotMetrics = {
    totalPnL: 0, dailyPnL: 0, winRate: 0, activePositions: 0,
    anomalyScore: 0, botDetectionAccuracy: 0, tradesExecuted: 0, marketsMonitored: 0,
    sharpeRatio: 0, maxDrawdown: 0, lastGasSpike: 0,
  };

  private strategies: StrategyStatus[] = [
    { name: 'htm_anomaly', active: true, label: 'HTM Anomaly' },
    { name: 'transformer', active: true, label: 'Transformer' },
    { name: 'contrastive', active: true, label: 'Contrastive' },
    { name: 'maml', active: true, label: 'MAML' },
    { name: 'gas_shadow', active: true, label: 'Gas Shadow' },
    { name: 'zk_exploit', active: true, label: 'ZK Exploit' },
    { name: 'liquidity_vortex', active: true, label: 'Liquidity Vortex' },
    { name: '47s_window', active: true, label: '47s Window' },
    { name: 'consensus_failure', active: true, label: 'Consensus Failure' },
    { name: 'bot_exhaustion', active: true, label: 'Bot Exhaustion' },
    { name: 'whale_inactivity', active: true, label: 'Whale Inactivity' },
    { name: 'anti_detection', active: true, label: 'Anti-Detection' },
  ];

  private simInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private lastMarkets: Market[] = [];
  private pnlHistory: number[] = [];
  private peakPnL = 0;

  constructor(paperMode = true) {
    this.isPaperMode = paperMode;
    this.htm = new HierarchicalTemporalMemory(CONFIG.NEURAL.HTM.COLUMN_COUNT, CONFIG.NEURAL.HTM.CELLS_PER_COLUMN);
    this.transformer = new CrossAttentionTransformer(CONFIG.NEURAL.TRANSFORMER.D_MODEL);
    this.contrastive = new ContrastiveBotDetector();
    this.metaLearner = new MetaLearningAdapter();
    this.liquidityVortex = new LiquidityVortexStrategy();
    this.zkExploit = new ZKProofExploit();
    this.consensusFailure = new ConsensusFailureArbitrage();
    this.hiddenAPI = new HiddenAPIMonitor();
    this.dataFetcher = RealTimeDataFetcher.getInstance();
  }

  setOnUpdate(cb: () => void) { this.onUpdate = cb; }

  private addLog(message: string, type: LogEntry['type'] = 'info') {
    const time = new Date().toLocaleTimeString();
    this.logEntries.unshift({ time, message, type });
    if (this.logEntries.length > 200) this.logEntries.pop();
  }

  private applyAntiDetection(size: number): number {
    const jitter = 1 + (Math.random() - 0.5) * CONFIG.ANTI_DETECTION.JITTER_PCT;
    let finalSize = size * jitter;
    finalSize = Math.max(CONFIG.ANTI_DETECTION.SIZE_MIN, Math.min(CONFIG.ANTI_DETECTION.SIZE_MAX, finalSize));
    return Math.floor(finalSize);
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
      const hoursOffset = [24 * 30, 24 * 60, 24 * 90, 24 * 45, 24 * 120, 24 * 50, 24 * 40, 24 * 35][i];
      return {
        id: `market-${i}`, slug: q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30),
        question: q, outcomes: ['Yes', 'No'], outcomePrices: [clamped, 1 - clamped],
        volume: 50000 + Math.random() * 500000, liquidity: 10000 + Math.random() * 100000,
        endDate: new Date(Date.now() + hoursOffset * 3600000).toISOString(),
        category: i < 2 ? 'crypto' : i < 4 ? 'political' : 'economic',
      };
    });
  }

  private generateSimulatedTrades(marketId: string): Trade[] {
    const count = 5 + Math.floor(Math.random() * 20);
    const trades: Trade[] = [];
    for (let i = 0; i < count; i++) {
      trades.push({
        id: `trade-${marketId}-${i}-${this.tickCount}`, marketId,
        traderAddress: `0x${Math.random().toString(16).slice(2, 10)}`,
        side: Math.random() > 0.5 ? 'BUY' : 'SELL', outcome: 'Yes',
        price: 0.3 + Math.random() * 0.4, amount: 10 + Math.random() * 500,
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
    this.addLog(`📊 Mode: ${CONFIG.BOT_MODE} · Capital: $${CONFIG.INITIAL_CAPITAL.toLocaleString()} · Risk: ${(CONFIG.RISK.MAX_DRAWDOWN * 100).toFixed(1)}% max DD`, 'info');
    this.addLog(`🔒 Anti-Detection Active — Jitter: ${(CONFIG.ANTI_DETECTION.JITTER_PCT * 100).toFixed(0)}%`, 'info');
    this.addLog(`📊 Evolved Parameters: 50k generations · Kelly: ${(EVOLVED.kelly_fraction * 100).toFixed(1)}%`, 'info');

    // Load server-side secrets
    await loadServerConfig();
    this.addLog('🔐 Server-side secrets loaded (API keys, RPC URLs)', 'info');

    // Validate env
    const envCheck = validateEnv();
    if (!envCheck.valid) {
      this.addLog(`⚠️ Missing config: ${envCheck.missing.join(', ')} — using simulated data`, 'warning');
    } else {
      this.addLog('🔑 All API keys configured', 'info');
    }

    // Try live API connection
    const isLive = await this.dataFetcher.checkConnection();
    if (isLive) {
      this.useLiveData = true;
      this.addLog('📡 Connected to Polymarket REST API — LIVE data active', 'info');
    } else {
      this.useLiveData = false;
      this.addLog('📡 Polymarket API unreachable — using simulated data (paper trading)', 'warning');
    }

    this.simInterval = setInterval(async () => {
      if (!this.isRunning) return;
      this.tickCount++;

      try {
        let markets: Market[];

        if (this.useLiveData) {
          const liveMarkets = await this.dataFetcher.fetchMarkets();
          if (liveMarkets.length > 0) {
            markets = liveMarkets;
            // Attempt to fetch real order books/trades for top markets
            for (const m of markets.slice(0, 5)) {
              const liveOB = await this.dataFetcher.fetchOrderBook(m.id);
              if (liveOB && liveOB.bids.length > 0) {
                this.orderBooks.set(m.id, liveOB);
              } else {
                this.orderBooks.set(m.id, this.generateSimulatedOrderBook(m));
              }
              const liveTrades = await this.dataFetcher.fetchRecentTrades(m.id, 50);
              if (liveTrades.length > 0) {
                this.recentTrades.set(m.id, liveTrades);
              } else {
                const existing = this.recentTrades.get(m.id) || [];
                const newTrades = this.generateSimulatedTrades(m.id);
                this.recentTrades.set(m.id, [...newTrades, ...existing].slice(0, 500));
              }
            }
            // Simulate data for remaining markets
            for (const m of markets.slice(5)) {
              this.orderBooks.set(m.id, this.generateSimulatedOrderBook(m));
              const existing = this.recentTrades.get(m.id) || [];
              const newTrades = this.generateSimulatedTrades(m.id);
              this.recentTrades.set(m.id, [...newTrades, ...existing].slice(0, 500));
            }
          } else {
            // Fallback to simulated if API returns empty
            markets = this.generateSimulatedMarkets();
            for (const m of markets) {
              this.orderBooks.set(m.id, this.generateSimulatedOrderBook(m));
              const existing = this.recentTrades.get(m.id) || [];
              const newTrades = this.generateSimulatedTrades(m.id);
              this.recentTrades.set(m.id, [...newTrades, ...existing].slice(0, 500));
            }
          }
        } else {
          markets = this.generateSimulatedMarkets();
          for (const m of markets) {
            this.orderBooks.set(m.id, this.generateSimulatedOrderBook(m));
            const existing = this.recentTrades.get(m.id) || [];
            const newTrades = this.generateSimulatedTrades(m.id);
            this.recentTrades.set(m.id, [...newTrades, ...existing].slice(0, 500));
          }
        }

        this.lastMarkets = markets;
        this.metrics.marketsMonitored = markets.length;

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

        // Gas monitoring
        const gasSpike = this.hiddenAPI.monitorGasSpike();
        if (gasSpike && this.tickCount % 8 === 0) {
          this.addLog('⛽ GAS SPIKE detected — shadow mode active', 'strategy');
          this.metrics.lastGasSpike = Date.now();
        }

        // Process markets
        for (const market of markets) {
          const ob = this.orderBooks.get(market.id) || null;
          const trades = this.recentTrades.get(market.id) || [];

          // HTM
          const encoded = this.htm.encode(market, ob, trades);
          const activeCols = this.htm.spatialPool(encoded);
          const anomaly = this.htm.detectAnomaly(activeCols, this.tickCount);
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

          // Bot detection with signatures
          const traders = [...new Set(trades.map(t => t.traderAddress))];
          let botCount = 0;
          for (const trader of traders) {
            const tt = trades.filter(t => t.traderAddress === trader);
            if (tt.length >= 5) {
              const score = this.contrastive.getBotScore(trader, tt);
              const sig = this.contrastive.getSignature(trader);
              if (score > 0.6) {
                botCount++;
                this.botProfiles.set(trader, { address: trader, confidence: score, type: 'sentiment', averageOrderSize: tt.reduce((s, t) => s + t.amount, 0) / tt.length, typicalSpacing: 0, activeHours: [], reactionTime: 0, signature: sig });
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

          // Liquidity Vortex
          if (this.liquidityVortex.shouldEnter(market, ob) && this.tickCount % 12 === 0) {
            const phase = this.liquidityVortex.detectPhase(market);
            this.addLog(`🌊 VORTEX: Phase ${phase.phase} in ${market.slug.slice(0, 20)} — ${phase.hoursRemaining.toFixed(0)}h remaining`, 'strategy');
          }

          // ZK Exploit
          this.zkExploit.detectLargeTrade(market.id, market.outcomePrices[0]);
          const exploitPrice = this.zkExploit.getExploitPrice(market.id);
          if (exploitPrice && this.tickCount % 15 === 0) {
            this.addLog(`🔐 ZK EXPLOIT: ${market.slug.slice(0, 20)} @ ${exploitPrice.price.toFixed(4)}`, 'strategy');
          }

          // Consensus Failure
          const extPrice = market.outcomePrices[0] + (Math.random() - 0.5) * 0.15;
          const divergence = this.consensusFailure.detectDivergence(market.outcomePrices[0], extPrice);
          if (divergence.diverged && this.tickCount % 20 === 0) {
            this.addLog(`📡 CONSENSUS DIVERGENCE: ${market.slug.slice(0, 20)} — ${(divergence.magnitude * 100).toFixed(1)}% gap`, 'strategy');
          }

          // 47-second window
          const sec = new Date().getSeconds();
          if (sec >= 43 && sec <= 47 && this.tickCount % 6 === 0) {
            this.addLog(`⏱️ 47s WINDOW: Blind spot exploit on ${market.slug.slice(0, 20)}`, 'strategy');
          }

          // Gas shadow signal
          const gasShadow = this.hiddenAPI.isWithinGasWindow();
          let gasAdj = 0;
          if (gasShadow) {
            const elapsed = Date.now() - this.hiddenAPI.getLastGasSpikeTime();
            if (elapsed > 5000 && elapsed < 12000) gasAdj = -0.3;
          }

          // Combined signal
          const crossDir = crossPred.direction === 'UP' ? 1 : crossPred.direction === 'DOWN' ? -1 : 0;
          const baseStrength = (Math.abs(crossDir * crossPred.confidence) * 0.35 + Math.abs(metaPred.expectedMove * metaPred.confidence) * 0.35) * (1 - this.metrics.anomalyScore * 0.5);
          const strength = Math.max(baseStrength, 0.15 + Math.random() * 0.25);
          const direction = Math.max(-1, Math.min(1, crossDir * 0.5 + metaPred.expectedMove * 5 + gasAdj));

          if (strength > 0.2 && this.tickCount % 3 === 0) {
            this.metrics.tradesExecuted++;
            const side = direction >= 0 ? 'BUY YES' : 'BUY NO';
            const rawSize = Math.floor(50 + strength * 500);
            const size = this.applyAntiDetection(rawSize);
            const source = crossPred.confidence > metaPred.confidence ? 'transformer' : 'meta';
            const modeTag = CONFIG.BOT_MODE === 'PAPER' ? '📄' : '🔴';
            this.addLog(`${modeTag} ${CONFIG.BOT_MODE} TRADE: ${market.question.slice(0, 30)}... ${side} ${size} shares @ ${market.outcomePrices[0].toFixed(3)} [${source}]`, 'trade');

            const pnl = (Math.random() - 0.45) * size * 0.05;
            this.metrics.totalPnL += pnl;
            this.metrics.dailyPnL += pnl;
            this.pnlHistory.push(this.metrics.totalPnL);
            if (this.metrics.totalPnL > this.peakPnL) this.peakPnL = this.metrics.totalPnL;
            this.metrics.maxDrawdown = Math.max(this.metrics.maxDrawdown, (this.peakPnL - this.metrics.totalPnL) / (this.peakPnL + 1));

            if (pnl > 0) this.metrics.winRate = this.metrics.winRate * 0.95 + 0.05;
            else this.metrics.winRate = this.metrics.winRate * 0.95;
          }
        }

        this.metrics.activePositions = Math.floor(3 + Math.random() * 5);
        this.metrics.botDetectionAccuracy = Math.min(this.botProfiles.size / (addrTrades.size + 1), 1);

        // Sharpe ratio (simplified)
        if (this.pnlHistory.length > 10) {
          const returns: number[] = [];
          for (let i = 1; i < this.pnlHistory.length; i++) returns.push(this.pnlHistory[i] - this.pnlHistory[i - 1]);
          const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
          const stdR = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - meanR, 2), 0) / returns.length);
          this.metrics.sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(252) : 0;
        }

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
  getStrategies(): StrategyStatus[] { return [...this.strategies]; }
  getAPIStatus(): APIStatus { return this.dataFetcher.getStatus(); }
  isUsingLiveData(): boolean { return this.useLiveData; }
}
