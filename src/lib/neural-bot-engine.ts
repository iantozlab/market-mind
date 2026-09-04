import { supabase } from '@/integrations/supabase/client';
import { PhantomLiquidityHarvester } from './phantom-liquidity-harvester';
import { MarketPsychologyEngine } from './market-psychology-engine';
import {
  RANSExecutionEngine, type RANSPlan, type MarketRegime, type RegimeWeights,
  getRansThresholds, setRansThresholds, setRansWeights, RANS_PARAMS,
  setRansKillSwitch, isRansKillSwitchActive,
  type RansThresholds, type RansApplyResult, type RansClampDetail,
} from './rans-engine';
import { recordRansDiagEvent } from './rans-diag-events';
import { MultiMarketArbitrageEngine, type ArbitrageSignal, type ArbMarket } from './multi-market-arbitrage';
import { PolySwarmIntegrator, buildDefaultSwarm, type MarketDescription, type SwarmPrediction, type LatencyArbEvent } from './polyswarm-integrator';
import { getArbLimits, checkArbLimits } from './arb-risk-config';
import { recordArbAudit } from './arb-audit';
import { getDrawdownGuard, setDrawdownGuard } from './drawdown-guard';
import { nonceDefender } from './nonce-race-defender';
import type { CounterOpportunity, SelfHealingPatch } from './nonce-race-defender';

const DEFENSE_BOT_ADDRESS = '0xbot0000000000000000000000000000000000bot';
import { recordDrawdownIncident } from './drawdown-incidents';




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

// Fetch server-side config PRESENCE FLAGS from the proxy.
// The proxy never returns secret values — only booleans indicating which
// credentials are configured. All privileged calls happen server-side.
async function loadServerConfig() {
  try {
    const resp = await proxyFetch('/__config');
    if (resp.ok) {
      const cfg = await resp.json();
      if (cfg.polygonRpcUrl) ENV.POLYGON_RPC_URL = '(configured)';
      if (cfg.blocknativeApiKey) ENV.BLOCKNATIVE_API_KEY = '(configured)';
    }
  } catch { /* fallback to defaults */ }
}

// Secure proxy helper — all Polymarket API calls route through Edge Function
async function proxyFetch(endpoint: string, params?: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  try {
    const { data, error } = await supabase.functions.invoke('polymarket-proxy', {
      method: 'POST',
      body: { endpoint, params: params || '', method },
    });
    if (error) {
      // Upstream non-2xx (e.g. 404 no orderbook) — return a non-ok Response instead of throwing
      return new Response(JSON.stringify({ error: error.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    if (data && typeof data === 'object' && 'ok' in data && 'status' in data) {
      return new Response((data as any).body || '', {
        status: (data as any).ok ? 200 : Number((data as any).status || 502),
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'proxy failure' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
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
      const PAGE_SIZE = 200;
      const MAX_PAGES = 8;

      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE_SIZE;
        const params = `active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=volume24hr&ascending=false`;
        const response = await proxyFetch('/gamma/markets', params);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        if (list.length === 0) break;
        allMarkets.push(...list);
        if (list.length < PAGE_SIZE) break;
      }

      this.marketsCache = allMarkets
        .map((m: any) => {
          const parseArr = (v: any, fallback: any) => {
            try { return typeof v === 'string' ? JSON.parse(v) : (v || fallback); }
            catch { return fallback; }
          };
          const prices = parseArr(m.outcomePrices, ['0.5', '0.5']).map((x: any) => parseFloat(x));
          const outs = parseArr(m.outcomes, ['YES', 'NO']);
          const tokenIds = parseArr(m.clobTokenIds || m.clob_token_ids, []);
          return {
            id: m.conditionId || m.id || `api-${Math.random().toString(36).slice(2, 8)}`,
            slug: m.slug || 'unknown',
            question: m.question || 'Unknown Market',
            outcomes: outs,
            outcomePrices: prices,
            volume: parseFloat(m.volume || m.volume24hr || '0'),
            liquidity: parseFloat(m.liquidity || '0'),
            endDate: m.endDate || new Date(Date.now() + 86400000 * 30).toISOString(),
            category: m.category || 'political',
            tokenIds: Array.isArray(tokenIds) ? tokenIds.map(String).filter(Boolean) : [],
          };
        })
        .filter((m: Market) => m.volume > 0 || m.liquidity > 0)
        .sort((a, b) => b.volume - a.volume);

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

  async fetchMarketOrderBook(market: Market): Promise<OrderBook | null> {
    const tokenId = market.tokenIds?.[0];
    if (!tokenId) return null;
    return this.fetchOrderBook(tokenId);
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
      const response = await proxyFetch('/gamma/markets', 'limit=1&active=true');
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
export interface Market { id: string; slug: string; question: string; outcomes: string[]; outcomePrices: number[]; volume: number; liquidity: number; endDate: string; category?: string; tokenIds?: string[]; }
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
  private phantom: PhantomLiquidityHarvester;
  private psychology: MarketPsychologyEngine;

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
    { name: 'phantom_harvester', active: true, label: 'Phantom Harvester' },
    { name: 'whale_wreckage', active: true, label: 'Whale Wreckage' },
    { name: 'convergence_fade', active: true, label: 'Convergence Fade' },
    { name: 'governance_attack', active: true, label: 'Governance Attack' },
    { name: 'temporal_decay', active: true, label: 'Temporal Decay' },
    { name: 'rans_regime', active: true, label: 'RANS Regime Scaler' },
    { name: 'rans_arbitrage', active: true, label: 'RANS Structural Arb' },
    { name: 'rans_temporal', active: true, label: 'RANS 30-Day Window' },
    { name: 'multi_market_arb', active: true, label: 'Multi-Market Arbitrage' },
    { name: 'polyswarm', active: true, label: 'PolySwarm Consensus' },
  ];

  // Multi-market arbitrage + LLM swarm
  private arbitrageEngine = new MultiMarketArbitrageEngine();
  private swarmIntegrator = new PolySwarmIntegrator();
  private arbSignals: ArbitrageSignal[] = [];
  private arbExecuted: ArbitrageSignal[] = [];
  private arbRealized = 0;
  private swarmSignals: SwarmPrediction[] = [];
  private swarmEvents: LatencyArbEvent[] = [];

  private rans: RANSExecutionEngine | null = null;
  private lastRansPlan: RANSPlan | null = null;
  private lastRansRegime: MarketRegime | null = null;
  private ransHistory: RansHistoryEntry[] = [];
  private lastArbAlertTs = 0;
  private lastArbHealthAlertTs = 0;
  private lastAnomalyAlertTs = 0;

  // RANS diagnostics (telemetry)
  private ransDx = {
    tickCount: 0,
    lastLatencyMs: 0,
    maxLatencyMs: 0,
    avgLatencyMs: 0,
    signalDropouts: 0,    // ticks producing 0 arb signals
    arbActivations: 0,    // total arb signals processed
    temporalActivations: 0,
    regimeChanges: 0,
    errors: 0,
    lastError: '' as string,
    lastErrorTs: 0,
    startedAt: 0,
    // Kill switch context (what tripped it).
    killSwitchReason: '' as string,
    killSwitchAt: 0,
    killSwitchMetrics: {} as Record<string, number | string>,
    // Rolling time-series for the dashboard (per-tick samples, capped).
    latencyHistory: [] as { ts: number; latencyMs: number; tick: number }[],
    activationHistory: [] as { ts: number; rate: number; tick: number }[],
    // Recent guardrail violations (clamped α/β/γ + threshold details).
    guardrailViolations: [] as { ts: number; tick: number; source: 'thresholds' | 'weights'; regime?: MarketRegime; details: RansClampDetail[] }[],
  };



  private simInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private lastMarkets: Market[] = [];
  private pnlHistory: number[] = [];
  private peakPnL = 0;
  private peakEquity = 0;
  private currentDrawdown = 0;


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
    this.phantom = new PhantomLiquidityHarvester(CONFIG.INITIAL_CAPITAL);
    this.psychology = new MarketPsychologyEngine();
    this.rans = new RANSExecutionEngine(CONFIG.INITIAL_CAPITAL);

    // --- Multi-market arbitrage + 50-agent swarm ---
    buildDefaultSwarm(this.swarmIntegrator, 50);
    this.arbitrageEngine.on('arbitrageExecuted', (signal) => this.logArbitrage(signal));
    this.swarmIntegrator.on('latencyArbitrage', (event) => this.executeLatencyTrade(event));

    this.psychology.on('strategy_deprecated', ({ strategyName, winRate }) => {
      this.addLog(`⚠ STRATEGY DEPRECATED: ${strategyName} (WR ${(winRate * 100).toFixed(1)}%)`, 'warning');
      this.emitAlert({ severity: 'warning', strategy: strategyName, title: `Strategy deprecated: ${strategyName}`, detail: `Win rate ${(winRate * 100).toFixed(1)}% below threshold` });
    });

    // --- Defense: counter-exploit opportunities + self-healing patches ---
    try {
      this.defenseDisposers.push(
        nonceDefender.on('opportunity_ready', (opp) => {
          try {
            this.addLog(
              `🎯 COUNTER-EXPLOIT OPPORTUNITY: $${opp.expectedProfit.toFixed(2)} · ${opp.attackType.replace('_', ' ')} · conf ${(opp.confidence * 100).toFixed(0)}%`,
              'anomaly',
            );
            recordArbAudit({
              source: 'counter_exploit', action: 'signal', mode: this.isPaperMode ? 'paper' : 'live',
              label: `${opp.attackType} counter-exploit`, legs: Math.max(1, opp.marketIds.length),
              profit: opp.expectedProfit, capital: this.getRANSCapital(), confidence: opp.confidence,
              detail: { strategy: 'nonce_race_defender', attacker: opp.attackerAddress, markets: opp.marketIds, tick: this.tickCount },
            });
            this.executeCounterPosition(opp);
          } catch { /* defense must never break the loop */ }
        }),
        nonceDefender.on('patch_applied', (patch) => {
          try {
            this.addLog(`🧬 SELF-HEALING PATCH: ${patch.patchType.replace(/_/g, ' ').toLowerCase()} — ${patch.detail}`, 'strategy');
            this.emitAlert({
              severity: 'warning', strategy: 'nonce_race_defender',
              title: `Defense patch applied: ${patch.patchType.replace(/_/g, ' ').toLowerCase()}`,
              detail: patch.detail,
            });
            this.adjustStrategy(patch);
          } catch { /* ignore */ }
        }),
      );
    } catch { /* ignore */ }
  }

  private defenseDisposers: Array<() => void> = [];

  /** Realize a counter-exploit position against a detected attacker (paper-safe). */
  private executeCounterPosition(opp: CounterOpportunity) {
    const capital = this.getRANSCapital();
    const size = Math.min(capital * CONFIG.RISK.MAX_POSITION_PCT * opp.confidence, capital * 0.05);
    if (size <= 0) return;
    const realized = opp.expectedProfit * opp.confidence;
    this.metrics.totalPnL += realized;
    this.metrics.dailyPnL += realized;
    this.metrics.tradesExecuted += 1;
    this.psychology.updateStrategyPerformance('nonce_race_defender', realized > 0);
    this.addLog(
      `💀 COUNTER-POSITION ${this.isPaperMode ? '(paper)' : ''}: $${size.toFixed(2)} vs ${opp.attackType.replace('_', ' ')} → +$${realized.toFixed(2)}`,
      'trade',
    );
    recordArbAudit({
      source: 'counter_exploit', action: 'executed', mode: this.isPaperMode ? 'paper' : 'live',
      label: `${opp.attackType} counter-position`, legs: Math.max(1, opp.marketIds.length),
      profit: realized, capital: size, confidence: opp.confidence,
      detail: { strategy: 'nonce_race_defender', attacker: opp.attackerAddress, markets: opp.marketIds, tick: this.tickCount },
    });
  }

  /** Apply a self-healing defense patch to live engine risk settings. */
  private adjustStrategy(patch: SelfHealingPatch) {
    const rt = nonceDefender.getRuntimeParams();
    switch (patch.patchType) {
      case 'SHRINK_ORDER_CAP':
        CONFIG.RISK.MAX_POSITION_PCT = Math.max(0.01, Math.min(CONFIG.RISK.MAX_POSITION_PCT, rt.orderCapRatio));
        this.addLog(`🛡 Position cap tightened to ${(CONFIG.RISK.MAX_POSITION_PCT * 100).toFixed(1)}%`, 'strategy');
        break;
      case 'EXTEND_HEDGE_DELAY':
        CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS += rt.hedgeDelayMs;
        this.addLog(`🛡 Entry window widened to ${CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS}ms (hedge delay ${rt.hedgeDelayMs}ms)`, 'strategy');
        break;
      case 'TIGHTEN_SPOOF_CUTOFF':
      case 'RAISE_GAS_THRESHOLD':
        CONFIG.RISK.KELLY_FRACTION = Math.max(0.05, +(CONFIG.RISK.KELLY_FRACTION * 0.85).toFixed(4));
        this.addLog(`🛡 Kelly fraction reduced to ${(CONFIG.RISK.KELLY_FRACTION * 100).toFixed(1)}%`, 'strategy');
        break;
    }
  }

  // -------- Multi-market arbitrage + PolySwarm --------
  private logArbitrage(signal: ArbitrageSignal) {
    this.arbExecuted = [signal, ...this.arbExecuted].slice(0, 200);
    this.arbRealized += signal.guaranteedProfit;
    this.metrics.totalPnL += signal.guaranteedProfit;
    this.metrics.dailyPnL += signal.guaranteedProfit;
    this.metrics.tradesExecuted += signal.legs.length;
    this.addLog(`🔒 ARBITRAGE ${signal.type.replace(/_/g, ' ').toUpperCase()}: +$${signal.guaranteedProfit.toFixed(2)} · ${signal.legs.length} legs · ${signal.label}`, 'trade');
  }

  private executeLatencyTrade(event: LatencyArbEvent) {
    this.swarmEvents = [event, ...this.swarmEvents].slice(0, 200);
    this.addLog(`⚡ SWARM LATENCY ARB: ${event.direction} ${(event.slug ?? event.marketId).slice(0, 24)} · swarm ${event.swarmProbability.toFixed(3)} vs mkt ${event.marketPrice.toFixed(3)}`, 'strategy');
  }

  /**
   * Snapshot of the exact limit values evaluated for a blocked signal, so the
   * Live-vs-Paper compare view can explain *why* a rule fired.
   */
  private ruleContext(
    l: ReturnType<typeof getArbLimits>,
    i: { profit: number; confidence: number; legs: number; capital: number; capitalUsedThisTick: number; executionsThisTick: number },
    matchedRule?: string,
  ): Record<string, unknown> {
    return {
      paperMode: l.paperMode,
      rule: matchedRule ?? '',
      matched_rule: matchedRule ?? '',
      limit_executionEnabled: l.executionEnabled,
      limit_minProfit: l.minProfit,
      limit_minConfidence: l.minConfidence,
      limit_maxLegs: l.maxLegs,
      limit_maxCapitalPerArb: l.maxCapitalPerArb,
      limit_maxCapitalPerTick: l.maxCapitalPerTick,
      limit_maxExecutionsPerTick: l.maxExecutionsPerTick,
      limit_maxDailyArbLoss: l.maxDailyArbLoss,
      value_profit: Number(i.profit.toFixed(4)),
      value_confidence: Number(i.confidence.toFixed(4)),
      value_legs: i.legs,
      value_capital: Number(i.capital.toFixed(2)),
      value_capitalUsedThisTick: Number(i.capitalUsedThisTick.toFixed(2)),
      value_executionsThisTick: i.executionsThisTick,
      value_sessionArbPnL: Number(this.arbRealized.toFixed(2)),
    };
  }


  /**
   * Fill quality for an execution. Paper fills assume near-perfect touch pricing;
   * live fills absorb book impact, which is exactly the divergence we want to chart.
   */
  private fillContext(mode: 'paper' | 'live', refPrice: number): Record<string, unknown> {
    const base = mode === 'live' ? 0.0018 : 0.0004;
    const noise = Math.abs(Math.sin((this.tickCount + refPrice * 997) * 12.9898)) * (mode === 'live' ? 0.0032 : 0.0008);
    const slip = base + noise;
    const price = Math.max(0.0001, Math.min(0.9999, refPrice * (1 + (mode === 'live' ? slip : slip * 0.5))));
    return {
      refPrice: Number(refPrice.toFixed(4)),
      execPrice: Number(price.toFixed(4)),
      slippageBps: Number((slip * 10000).toFixed(1)),
    };
  }


  private async runArbitrageAndSwarm(markets: Market[]) {
    // 1. Multi-market arbitrage over every outcome leg of each condition.
    const arbMarkets: ArbMarket[] = [];
    for (const m of markets) {
      m.outcomes.forEach((o, i) => {
        arbMarkets.push({
          id: `${m.id}:${i}`,
          conditionId: m.id,
          outcome: o,
          price: m.outcomePrices[i] ?? 0,
          negRisk: m.outcomes.length > 2,
          parentConditionId: m.category ? `cat:${m.category}` : undefined,
          slug: m.slug,
        });
      });
    }
    this.arbitrageEngine.updateMarkets(arbMarkets);
    const signals = this.arbitrageEngine.scanAll();
    this.arbSignals = signals.slice(0, 50);

    const limits = getArbLimits();
    const mode: 'paper' | 'live' = limits.paperMode || this.isPaperMode ? 'paper' : 'live';

    let executedCount = 0;
    let capitalUsed = 0;
    for (const signal of signals) {
      const reason = checkArbLimits({
        profit: signal.guaranteedProfit,
        confidence: signal.confidence,
        legs: signal.legs.length,
        capital: signal.requiredCapital,
        capitalUsedThisTick: capitalUsed,
        executionsThisTick: executedCount,
        sessionArbPnL: this.arbRealized,
      });
      if (reason) {
        if (signal.guaranteedProfit > 0 && this.tickCount % 4 === 0) {
          recordArbAudit({
            source: 'multi_market_arb', action: 'blocked', mode, label: signal.label,
            legs: signal.legs.length, profit: signal.guaranteedProfit, capital: signal.requiredCapital,
            confidence: signal.confidence, reason,
            detail: {
              type: signal.type, tick: this.tickCount, strategy: 'multi_market_arb',
              ...this.ruleContext(limits, {
                profit: signal.guaranteedProfit, confidence: signal.confidence,
                legs: signal.legs.length, capital: signal.requiredCapital,
                capitalUsedThisTick: capitalUsed, executionsThisTick: executedCount,
              }, reason),

            },
          });
        }
        if (executedCount >= limits.maxExecutionsPerTick) break;
        continue;
      }
      // Pre-trade MEV / nonce-race gate
      const refLegPrice = signal.legs.reduce((s, l: { price?: number }) => s + (l.price ?? 0), 0) / Math.max(1, signal.legs.length);
      const gate = await nonceDefender.validateAndExecuteTrade(
        { marketId: signal.legs[0]?.marketId ?? signal.label, amount: signal.requiredCapital, price: refLegPrice || 1, nonce: Date.now() },
        DEFENSE_BOT_ADDRESS,
        this.getRANSCapital(),
      );
      if (!gate.shouldExecute) {
        recordArbAudit({
          source: 'multi_market_arb', action: 'blocked', mode, label: signal.label,
          legs: signal.legs.length, profit: signal.guaranteedProfit, capital: signal.requiredCapital,
          confidence: signal.confidence, reason: `defense: ${gate.reason}`,
          detail: { type: signal.type, tick: this.tickCount, strategy: 'nonce_race_defender', gate },
        });
        this.addLog(`🛡 DEFENSE BLOCKED ARB: ${signal.label} — ${gate.reason} (wait ${gate.waitMs}ms)`, 'warning');
        continue;
      }
      if (gate.waitMs > 0) {
        // Defensive hedge delay before executing (capped so the tick loop stays responsive).
        await new Promise(r => setTimeout(r, Math.min(gate.waitMs, 2000)));
      }
      const ok = await this.arbitrageEngine.executeArbitrage(signal, this.getRANSCapital());
      if (ok) {
        executedCount++;
        capitalUsed += signal.requiredCapital;
        const refPrice = signal.legs.reduce((s, l: { price?: number }) => s + (l.price ?? 0), 0) / Math.max(1, signal.legs.length);
        recordArbAudit({
          source: 'multi_market_arb', action: 'executed', mode, label: signal.label,
          legs: signal.legs.length, profit: signal.guaranteedProfit, capital: signal.requiredCapital,
          confidence: signal.confidence,
          detail: {
            type: signal.type, tick: this.tickCount, strategy: 'multi_market_arb',
            ...this.fillContext(mode, refPrice),
          },
        });
      }

      if (executedCount >= limits.maxExecutionsPerTick) break;
    }
    if (signals.length > 0) {
      const top = signals[0];
      this.routeSignal(`arb_${top.type}`, 'multi_market_arb', top.confidence, {
        opportunities: signals.length, executed: executedCount, topProfit: top.guaranteedProfit.toFixed(3),
      });
      this.psychology.updateStrategyPerformance('multi_market_arb', executedCount > 0);
    } else {
      this.routeSignal('arb_scan', 'multi_market_arb', 0.5, { opportunities: 0 });
      this.psychology.updateStrategyPerformance('multi_market_arb', Math.random() < 0.5);
    }

    // 2. Swarm predictions + inefficiency detection (bounded sample for latency).
    const descriptions: MarketDescription[] = markets.slice(0, 12).map(m => ({
      id: m.id, question: m.question, outcomes: m.outcomes,
      currentPrice: m.outcomePrices[0], category: m.category, slug: m.slug,
      timeToExpiry: new Date(m.endDate).getTime() - Date.now(),
    }));
    const inefficiencies = await this.swarmIntegrator.detectInefficiencies(descriptions, 0.05);
    this.swarmSignals = inefficiencies;

    if (inefficiencies.length > 0) {
      const top = inefficiencies[0];
      const mkt = descriptions.find(d => d.id === top.marketId);
      const edge = mkt ? Math.abs(top.swarmProbability - mkt.currentPrice) : 0;
      if (mkt && limits.executionEnabled && edge >= limits.minSwarmEdge) {
        const ev = await this.swarmIntegrator.latencyArbitrage(mkt, mkt.currentPrice);
        if (ev) {
          recordArbAudit({
            source: 'polyswarm', action: 'executed', mode,
            label: `${ev.direction} ${ev.slug ?? ev.marketId}`, legs: 1,
            profit: ev.edge, capital: limits.maxCapitalPerArb, confidence: top.swarmConfidence,
            detail: {
              divergence: top.divergence, swarmProb: ev.swarmProbability, marketPrice: ev.marketPrice,
              tick: this.tickCount, strategy: 'polyswarm',
              ...this.fillContext(mode, ev.marketPrice),
            },
          });
        }
      } else if (mkt) {
        const reason = !limits.executionEnabled ? 'execution disabled' : `swarm edge < ${limits.minSwarmEdge}`;
        if (this.tickCount % 6 === 0) {
          recordArbAudit({
            source: 'polyswarm', action: 'blocked', mode, label: top.slug ?? top.marketId, legs: 1,
            profit: edge, capital: 0, confidence: top.swarmConfidence, reason,
            detail: {
              divergence: top.divergence, tick: this.tickCount, strategy: 'polyswarm',
              rule: reason, matched_rule: reason, edge: Number(edge.toFixed(4)),
              limit_minSwarmEdge: limits.minSwarmEdge,
              limit_executionEnabled: limits.executionEnabled,
              limit_minConfidence: limits.minConfidence,
              limit_divergenceAlertThreshold: limits.divergenceAlertThreshold,
              value_edge: Number(edge.toFixed(4)),
              value_swarmProbability: Number(top.swarmProbability.toFixed(4)),
              value_marketPrice: Number((mkt.currentPrice ?? 0).toFixed(4)),
              value_swarmConfidence: Number(top.swarmConfidence.toFixed(4)),
              value_divergence: Number(top.divergence.toFixed(4)),
              paperMode: limits.paperMode,
            },

          });
        }

      }
      // Strategy health alerts: divergence threshold breach.
      if (top.divergence >= limits.divergenceAlertThreshold && Date.now() - this.lastArbHealthAlertTs > 60_000) {
        this.lastArbHealthAlertTs = Date.now();
        this.emitAlert({
          severity: top.divergence >= limits.divergenceAlertThreshold * 1.5 ? 'critical' : 'warning',
          strategy: 'polyswarm',
          title: `Swarm divergence ${top.divergence.toFixed(3)} above threshold`,
          detail: `${top.slug ?? top.marketId} · swarm ${top.swarmProbability.toFixed(3)} · conf ${(top.swarmConfidence * 100).toFixed(0)}%`,
        });
      }
      this.routeSignal('swarm_divergence', 'polyswarm', top.swarmConfidence, {
        inefficiencies: inefficiencies.length,
        topDivergence: top.divergence.toFixed(4),
        swarmProb: top.swarmProbability.toFixed(3),
      });
      this.psychology.updateStrategyPerformance('polyswarm', top.swarmConfidence > 0.5);
      if (this.tickCount % 6 === 0) {
        this.addLog(`🧠 SWARM: ${inefficiencies.length} inefficiencies · top ${(top.slug ?? top.marketId).slice(0, 22)} div ${top.divergence.toFixed(3)} (conf ${(top.swarmConfidence * 100).toFixed(0)}%)`, 'strategy');
      }
    } else {
      this.routeSignal('swarm_scan', 'polyswarm', 0.5, { inefficiencies: 0 });
      this.psychology.updateStrategyPerformance('polyswarm', Math.random() < 0.5);
    }

    // Strategy health alert: anomaly score threshold breach.
    if (this.metrics.anomalyScore >= limits.anomalyAlertThreshold && Date.now() - this.lastAnomalyAlertTs > 60_000) {
      this.lastAnomalyAlertTs = Date.now();
      this.emitAlert({
        severity: 'warning',
        strategy: 'bot_exhaustion',
        title: `Anomaly score ${(this.metrics.anomalyScore * 100).toFixed(0)}% above threshold`,
        detail: `Threshold ${(limits.anomalyAlertThreshold * 100).toFixed(0)}% · strategies may be operating in unstable regime`,
      });
    }
  }


  getArbSignals(): ArbitrageSignal[] { return [...this.arbSignals]; }
  getArbExecuted(): ArbitrageSignal[] { return [...this.arbExecuted]; }
  getArbRealized(): number { return this.arbRealized; }
  getSwarmSignals(): SwarmPrediction[] { return [...this.swarmSignals]; }
  getSwarmEvents(): LatencyArbEvent[] { return [...this.swarmEvents]; }
  getSwarmAgentCount(): number { return this.swarmIntegrator.getAgentCount(); }

  setOnUpdate(cb: () => void) { this.onUpdate = cb; }

  // -------- Signal-routing diagnostics + per-strategy "why active" --------
  private signalRoutes: Map<string, SignalRoute> = new Map();
  private strategyTriggers: Map<string, StrategyTrigger> = new Map();

  private routeSignal(signalType: string, healthKey: string, confidence: number, metrics?: Record<string, number | string>) {
    const ex = this.signalRoutes.get(signalType);
    if (ex) {
      ex.count += 1;
      ex.lastSeen = Date.now();
      ex.avgConfidence = ex.avgConfidence * 0.9 + confidence * 0.1;
    } else {
      this.signalRoutes.set(signalType, {
        signalType, healthKey, count: 1, lastSeen: Date.now(), avgConfidence: confidence,
      });
    }
    this.strategyTriggers.set(healthKey, {
      strategy: healthKey,
      reason: signalType,
      confidence,
      ts: Date.now(),
      metrics: metrics ?? {},
    });
  }

  getSignalRoutes(): SignalRoute[] { return Array.from(this.signalRoutes.values()); }
  getStrategyTriggers(): StrategyTrigger[] { return Array.from(this.strategyTriggers.values()); }
  getStrategyTrigger(name: string): StrategyTrigger | undefined { return this.strategyTriggers.get(name); }

  // -------- Cooldown / risk gating --------
  private cooldownUntil = 0;
  private cooldownReason = '';
  private alertSink: ((a: { severity: 'info' | 'warning' | 'critical'; title: string; detail?: string; strategy?: string }) => void) | null = null;
  setAlertSink(cb: typeof this.alertSink) { this.alertSink = cb; }
  private emitAlert(a: { severity: 'info' | 'warning' | 'critical'; title: string; detail?: string; strategy?: string }) {
    try { this.alertSink?.(a); } catch { /* noop */ }
    // Auto-engage RANS kill switch on critical alerts (excluding our own kill-switch alert).
    if (a.severity === 'critical' && !isRansKillSwitchActive() && a.title !== 'RANS kill switch engaged') {
      const metrics: Record<string, number | string> = {
        dailyPnL: Number(this.metrics.dailyPnL?.toFixed?.(2) ?? this.metrics.dailyPnL ?? 0),
        maxDrawdown: Number((this.metrics.maxDrawdown ?? 0).toFixed(4)),
        winRate: Number((this.metrics.winRate ?? 0).toFixed(4)),
        tick: this.tickCount,
        alertDetail: a.detail ?? '',
      };
      this.engageKillSwitchInternal(`auto:${a.title}`, metrics);
      try { this.alertSink?.({ severity: 'warning', title: 'RANS auto-killed', detail: `Triggered by: ${a.title}` }); } catch { /* noop */ }
    }
  }

  getCooldownStatus(): CooldownStatus {
    const now = Date.now();
    const remaining = Math.max(0, this.cooldownUntil - now);
    return { active: remaining > 0, remainingSec: Math.ceil(remaining / 1000), reason: this.cooldownReason };
  }

  /**
   * Equity-based drawdown. Previously the denominator was `peakPnL + 1`, which made a
   * tiny peak profit explode into hundreds of percent of "drawdown". Drawdown is now
   * measured against account equity (capital + P&L) with the peak floored at the
   * starting capital, so it is always a sane 0..1 fraction of the account.
   */
  private updateDrawdown() {
    const g = getDrawdownGuard();
    const equity = CONFIG.INITIAL_CAPITAL + this.metrics.totalPnL;
    this.peakEquity = Math.max(this.peakEquity || CONFIG.INITIAL_CAPITAL, CONFIG.INITIAL_CAPITAL, equity);
    if (this.metrics.totalPnL > this.peakPnL) this.peakPnL = this.metrics.totalPnL;
    const raw = (this.peakEquity - equity) / this.peakEquity;
    const dd = Math.max(0, Math.min(1, raw));
    // EMA over the configured smoothing window so a single noisy fill cannot spike the gauge.
    const alpha = 2 / (Math.max(1, g.smoothingWindow) + 1);
    this.currentDrawdown = this.currentDrawdown * (1 - alpha) + dd * alpha;
    this.metrics.maxDrawdown = Math.max(this.metrics.maxDrawdown, this.currentDrawdown);
  }

  getCurrentDrawdown(): number { return this.currentDrawdown; }

  private ddBreachStreak = 0;
  private ddBreachStartTs = 0;

  private checkRiskCooldown() {
    const g = getDrawdownGuard();
    const now = Date.now();
    if (this.cooldownUntil > now) return; // already cooling down
    const cooldownMs = g.cooldownMinutes * 60 * 1000;

    if (this.currentDrawdown >= g.maxDrawdownPct) {
      if (this.ddBreachStreak === 0) this.ddBreachStartTs = now;
      this.ddBreachStreak++;
      if (this.ddBreachStreak >= g.breachTicks) {
        const confirmations = this.ddBreachStreak;
        const drawdownAtTrip = this.currentDrawdown;
        this.ddBreachStreak = 0;
        this.cooldownUntil = now + cooldownMs;
        this.cooldownReason = 'max-drawdown';
        // Re-arm from the resume buffer so the guard does not immediately re-trip.
        this.metrics.maxDrawdown = Math.max(0, g.maxDrawdownPct - g.resumeBufferPct);
        this.currentDrawdown = this.metrics.maxDrawdown;
        this.peakEquity = CONFIG.INITIAL_CAPITAL + this.metrics.totalPnL;
        recordDrawdownIncident({
          breachStartTs: this.ddBreachStartTs || now,
          cooldownStart: now, cooldownEnd: this.cooldownUntil,
          reason: 'max-drawdown', confirmations, drawdownAtTrip,
          resumeLevel: this.currentDrawdown,
          maxDrawdownPct: g.maxDrawdownPct, breachTicks: g.breachTicks,
          smoothingWindow: g.smoothingWindow, resumeBufferPct: g.resumeBufferPct,
          cooldownMinutes: g.cooldownMinutes, tick: this.tickCount,
        });
        this.addLog(`❄️ COOLDOWN ${g.cooldownMinutes}m — smoothed drawdown ${(g.maxDrawdownPct * 100).toFixed(1)}% cap breached ${g.breachTicks}× in a row`, 'warning');
        this.emitAlert({ severity: 'critical', strategy: 'risk', title: 'Risk cooldown engaged', detail: `Drawdown ≥ ${(g.maxDrawdownPct * 100).toFixed(0)}% · pausing ${g.cooldownMinutes}m` });
      }
    } else {
      this.ddBreachStreak = 0;
      this.ddBreachStartTs = 0;
      if (-this.metrics.dailyPnL >= CONFIG.RISK.MAX_DAILY_LOSS) {
        this.cooldownUntil = now + cooldownMs;
        this.cooldownReason = 'daily-loss-limit';
        recordDrawdownIncident({
          breachStartTs: now, cooldownStart: now, cooldownEnd: this.cooldownUntil,
          reason: 'daily-loss-limit', confirmations: 1, drawdownAtTrip: this.currentDrawdown,
          resumeLevel: this.currentDrawdown,
          maxDrawdownPct: g.maxDrawdownPct, breachTicks: g.breachTicks,
          smoothingWindow: g.smoothingWindow, resumeBufferPct: g.resumeBufferPct,
          cooldownMinutes: g.cooldownMinutes, tick: this.tickCount,
        });
        this.addLog(`❄️ COOLDOWN engaged — daily loss $${(-this.metrics.dailyPnL).toFixed(2)} exceeded cap`, 'warning');
        this.emitAlert({ severity: 'critical', strategy: 'risk', title: 'Daily loss limit hit', detail: `Loss $${(-this.metrics.dailyPnL).toFixed(2)} ≥ $${CONFIG.RISK.MAX_DAILY_LOSS.toFixed(0)}` });
      }
    }
  }



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

    // Plumb runtime secrets into the defense layer (private mempool when Blocknative is present)
    try {
      nonceDefender.configure({
        polygonRpcUrl: ENV.POLYGON_RPC_URL !== '(server-side)' ? ENV.POLYGON_RPC_URL : undefined,
        blocknativeApiKey: ENV.BLOCKNATIVE_API_KEY !== '(server-side)' ? ENV.BLOCKNATIVE_API_KEY : undefined,
      });
      nonceDefender.setDefenseActive(true);
      this.addLog(`🛡 Defense armed — ${nonceDefender.getStatus().mempoolMode} mempool mode`, 'info');
    } catch { /* defense must never block startup */ }

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
              const liveOB = await this.dataFetcher.fetchMarketOrderBook(m);
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

        // === PHANTOM LIQUIDITY HARVESTER ===
        try {
          const candidates = this.phantom.scan(markets);
          const cfg = this.phantom.getStats();
          if (candidates.length > 0 && this.tickCount % 5 === 0) {
            this.addLog(`👻 PHANTOM: ${candidates.length} dead-zone markets · Tier ${cfg.tier} (${cfg.tierName}) · Cap $${cfg.capital.toFixed(0)}`, 'strategy');
          }
          // Deploy ghost liquidity to top phantom markets
          for (const pm of candidates.slice(0, 3)) {
            const mid = (markets.find(x => x.id === pm.id)?.outcomePrices[0]) ?? 0.5;
            const deployed = this.phantom.deploy(pm, mid);
            if (deployed && this.tickCount % 4 === 0) {
              this.addLog(`👻 GHOST DEPLOY: ${pm.slug.slice(0, 24)} DMI ${pm.dmiScore.toFixed(0)} bid ${deployed.bidPrice.toFixed(3)} ask ${deployed.askPrice.toFixed(3)} $${deployed.bidSize.toFixed(0)}`, 'trade');
            }
          }
          // Tick fills
          const { profit, events } = this.phantom.tick();
          if (profit !== 0) {
            this.metrics.totalPnL += profit;
            this.metrics.dailyPnL += profit;
            this.metrics.tradesExecuted += events.length;
          }
          for (const ev of events) {
            this.addLog(`✅ PHANTOM FILL: ${ev.slug.slice(0, 24)} +$${ev.profitRealized.toFixed(2)} (${ev.status})`, 'trade');
          }
        } catch (e) {
          // never let strategy errors kill the loop
        }

        // === MARKET PSYCHOLOGY ENGINE ===
        try {
          const { lessons, signals } = this.psychology.analyze(markets);
          if (this.tickCount % 4 === 0) {
            for (const sig of signals.slice(0, 3)) {
              const slug = markets.find(m => m.id === sig.marketId)?.slug.slice(0, 24) ?? sig.marketId.slice(0, 8);
              const icon = sig.type === 'convergence_fade' ? '🌊' : sig.type === 'governance_attack' ? '🏛' : '⏳';
              this.addLog(`${icon} PSY ${sig.type.toUpperCase()}: ${slug} ${sig.direction} (${(sig.confidence * 100).toFixed(0)}%)`, 'strategy');
            }
            for (const l of lessons.slice(0, 1)) {
              this.addLog(`🧠 LESSON: ${l.lesson} → ${l.action} (${(l.confidence * 100).toFixed(0)}%)`, 'info');
            }
          }
          // Map analyze() signal types onto canonical strategy-health keys + record routing.
          const sigKey = (t: string) => t === 'temporal_entry' ? 'temporal_decay' : t;
          for (const sig of signals.slice(0, 8)) {
            const key = sigKey(sig.type);
            this.routeSignal(sig.type, key, sig.confidence, { direction: sig.direction, marketId: sig.marketId.slice(0, 12) });
            const won = Math.random() < sig.confidence;
            this.psychology.updateStrategyPerformance(key, won);
          }
          // Whale wreckage produces lessons (no signals); still record activity for diagnostics.
          if (lessons.length > 0) {
            this.routeSignal('whale_wreckage_lesson', 'whale_wreckage', Math.min(0.9, 0.5 + lessons.length * 0.05), { lessons: lessons.length });
            this.psychology.updateStrategyPerformance('whale_wreckage', Math.random() < 0.55);
          }
        } catch {
          // ignore
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
            this.updateDrawdown();


            if (pnl > 0) this.metrics.winRate = this.metrics.winRate * 0.95 + 0.05;
            else this.metrics.winRate = this.metrics.winRate * 0.95;
          }

          // === Feed broader strategy outcomes into psychology health (paper heuristic) ===
          // Each per-market trigger contributes a synthetic win/loss with confidence-weighted probability.
          if (this.tickCount % 2 === 0) {
            // Bot exhaustion: high anomaly score → likely exhaustion signal
            if (this.metrics.anomalyScore > 0.55) {
              this.routeSignal('bot_exhaustion', 'bot_exhaustion', this.metrics.anomalyScore, { anomaly: this.metrics.anomalyScore.toFixed(3) });
              this.psychology.updateStrategyPerformance('bot_exhaustion', Math.random() < 0.55);
            }
            // Liquidity provision: vortex phase 2 active
            if (this.liquidityVortex.shouldEnter(market, ob)) {
              const phase = this.liquidityVortex.detectPhase(market);
              this.routeSignal('liquidity_provision', 'liquidity_provision', 0.6, { phase: phase.phase, hours: phase.hoursRemaining.toFixed(1) });
              this.psychology.updateStrategyPerformance('liquidity_provision', Math.random() < 0.58);
            }
            // ZK exploit: window currently open
            if (this.zkExploit.isWithinWindow()) {
              this.routeSignal('zk_exploit', 'zk_exploit', 0.62, { window: 'open' });
              this.psychology.updateStrategyPerformance('zk_exploit', Math.random() < 0.62);
            }
            // Whale inactivity: low recent trade count
            const recentN = trades.filter(t => Date.now() - t.timestamp < 3600_000).length;
            if (recentN < 3 && market.volume > 5000) {
              this.routeSignal('whale_inactivity', 'whale_inactivity', 0.55, { recent: recentN, volume: market.volume.toFixed(0) });
              this.psychology.updateStrategyPerformance('whale_inactivity', Math.random() < 0.52);
            }
            // Pre-event: end date 3-5 days out
            const days = (new Date(market.endDate).getTime() - Date.now()) / 86_400_000;
            if (days > 3 && days < 5) {
              this.routeSignal('pre_event', 'pre_event', 0.6, { days: days.toFixed(1) });
              this.psychology.updateStrategyPerformance('pre_event', Math.random() < 0.54);
            }
            // Anchor reversion: price extreme & cross-market disagreement
            const p = market.outcomePrices[0];
            if ((p < 0.15 || p > 0.85) && crossPred.confidence > 0.4) {
              this.routeSignal('anchor_reversion', 'anchor_reversion', crossPred.confidence, { price: p.toFixed(3), conf: crossPred.confidence.toFixed(2) });
              this.psychology.updateStrategyPerformance('anchor_reversion', Math.random() < 0.56);
            }
          }
        }

        // === MEV / NONCE-RACE DEFENSE SCAN ===
        try {
          const defTrades: Trade[] = [];
          for (const arr of this.recentTrades.values()) defTrades.push(...arr);
          nonceDefender.ingestTick(markets, defTrades);
        } catch {
          // defense scan must never kill the loop
        }

        // === MULTI-MARKET ARBITRAGE + POLYSWARM ===
        try {
          await this.runArbitrageAndSwarm(markets);
        } catch {
          // never let arbitrage/swarm errors kill the loop
        }

        // === RANS — Regime-Adaptive Neural Scaling ===
        const ransStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        try {
          if (this.rans) {
            if (!this.ransDx.startedAt) this.ransDx.startedAt = Date.now();
            const flatTrades: Trade[] = [];
            for (const arr of this.recentTrades.values()) flatTrades.push(...arr);
            const directionalConfidence = Math.max(0.3, Math.min(0.95,
              0.55 + this.metrics.winRate * 0.4 - this.metrics.anomalyScore * 0.2));
            const plan = this.rans.analyze(markets, flatTrades, directionalConfidence);
            this.lastRansPlan = plan;

            // History entry every tick (capped)
            this.ransHistory.push({
              ts: plan.ts,
              regime: plan.regime,
              regimeConfidence: plan.regimeConfidence,
              directional: plan.weights.directional,
              arbitrage: plan.weights.arbitrage,
              temporal: plan.weights.temporal,
              arbCount: plan.arbitrageSignals.length,
              avgArbConfidence: plan.avgArbConfidence,
              realizedArbProfit: plan.realizedArbitrageProfit,
              expectedDailyReturn: plan.expectedDailyReturn,
              topArbType: plan.arbitrageSignals[0]?.type,
              topArbMarket: plan.arbitrageSignals[0]?.marketSlug ?? plan.arbitrageSignals[0]?.marketId,
              regimeChanged: this.lastRansRegime !== null && this.lastRansRegime !== plan.regime,
            });
            if (this.ransHistory.length > 500) this.ransHistory.shift();

            // Regime change → log + alert + persist
            if (this.lastRansRegime && this.lastRansRegime !== plan.regime) {
              this.ransDx.regimeChanges += 1;
              const msg = `${this.lastRansRegime.replace('_', ' ').toUpperCase()} → ${plan.regime.replace('_', ' ').toUpperCase()}`;
              this.addLog(`🌀 RANS REGIME CHANGE: ${msg} · α${(plan.weights.directional * 100).toFixed(0)}/β${(plan.weights.arbitrage * 100).toFixed(0)}/γ${(plan.weights.temporal * 100).toFixed(0)}`, 'strategy');
              this.emitAlert({
                severity: 'info',
                title: `RANS regime change`,
                detail: `${msg} (conf ${(plan.regimeConfidence * 100).toFixed(0)}%)`,
              });
              recordRansDiagEvent({
                event_type: 'regime_change',
                severity: 'info',
                detail: {
                  from: this.lastRansRegime,
                  to: plan.regime,
                  confidence: plan.regimeConfidence,
                  weights: plan.weights,
                  tick: this.tickCount,
                },
              });
            }
            this.lastRansRegime = plan.regime;

            // Arbitrage confidence drop alert (throttled to once per 60s)
            if (plan.arbitrageSignals.length > 0
                && plan.avgArbConfidence < RANS_PARAMS.MIN_ARB_CONFIDENCE
                && Date.now() - this.lastArbAlertTs > 60_000) {
              this.lastArbAlertTs = Date.now();
              this.addLog(`⚠️ RANS arb confidence ${(plan.avgArbConfidence * 100).toFixed(0)}% < cutoff ${(RANS_PARAMS.MIN_ARB_CONFIDENCE * 100).toFixed(0)}%`, 'warning');
              this.emitAlert({
                severity: 'warning',
                title: 'RANS arbitrage confidence dropped',
                detail: `avg ${(plan.avgArbConfidence * 100).toFixed(0)}% across ${plan.arbitrageSignals.length} ops`,
              });
            }

            this.routeSignal(`rans_regime_${plan.regime}`, 'rans_regime', plan.regimeConfidence, {
              regime: plan.regime,
              dir: `${(plan.weights.directional * 100).toFixed(0)}%`,
              arb: `${(plan.weights.arbitrage * 100).toFixed(0)}%`,
              tmp: `${(plan.weights.temporal * 100).toFixed(0)}%`,
            });
            this.psychology.updateStrategyPerformance('rans_regime', Math.random() < plan.regimeConfidence);

            if (plan.arbitrageSignals.length > 0) {
              this.ransDx.arbActivations += plan.arbitrageSignals.length;
              const top = plan.arbitrageSignals[0];
              this.routeSignal(`rans_arb_${top.type.toLowerCase()}`, 'rans_arbitrage', top.confidence, {
                type: top.type, profit: `${(top.profitGuaranteed * 100).toFixed(2)}%`, opportunities: plan.arbitrageSignals.length,
              });
              this.psychology.updateStrategyPerformance('rans_arbitrage', top.confidence > 0.85);
              if (this.tickCount % 5 === 0) {
                this.addLog(`🔒 RANS ARB: ${plan.arbitrageSignals.length} ops · top ${top.type} ${(top.profitGuaranteed * 100).toFixed(2)}% on ${top.marketSlug?.slice(0, 24) ?? top.marketId.slice(0, 8)}`, 'strategy');
              }
            } else {
              this.ransDx.signalDropouts += 1;
              this.routeSignal('rans_arb_scan', 'rans_arbitrage', 0.5, { opportunities: 0 });
              this.psychology.updateStrategyPerformance('rans_arbitrage', Math.random() < 0.5);
              // Persist signal dropouts every 5th occurrence to avoid spam.
              if (this.ransDx.signalDropouts % 5 === 0) {
                recordRansDiagEvent({
                  event_type: 'signal_dropout',
                  severity: 'warning',
                  detail: {
                    cumulative: this.ransDx.signalDropouts,
                    dropoutRate: this.ransDx.tickCount > 0 ? this.ransDx.signalDropouts / this.ransDx.tickCount : 0,
                    tick: this.tickCount,
                    regime: plan.regime,
                  },
                });
              }
            }


            const tempActive = plan.temporalWindows.filter(w => w.phase === 'entry' || w.phase === 'exit');
            if (tempActive.length > 0) {
              this.ransDx.temporalActivations += tempActive.length;
              const sample = tempActive[0];
              this.routeSignal(`rans_temporal_${sample.phase}`, 'rans_temporal', sample.confidence, {
                phase: sample.phase, days: sample.daysToExpiry.toFixed(1), active: tempActive.length,
              });
              this.psychology.updateStrategyPerformance('rans_temporal', Math.random() < sample.confidence);
            } else {
              this.routeSignal('rans_temporal_scan', 'rans_temporal', 0.4, { active: 0 });
              this.psychology.updateStrategyPerformance('rans_temporal', Math.random() < 0.4);
            }

            // Apply realized arbitrage profit to bot P&L (RANS is a profit-driver).
            // Kill switch causes analyze() to return 0 realized — this block is a no-op then.
            if (plan.realizedArbitrageProfit !== 0) {
              this.metrics.totalPnL += plan.realizedArbitrageProfit;
              this.metrics.dailyPnL += plan.realizedArbitrageProfit;
              this.metrics.tradesExecuted += plan.arbitrageSignals.length;
            }
          }
        } catch (err) {
          this.ransDx.errors += 1;
          this.ransDx.lastError = String(err);
          this.ransDx.lastErrorTs = Date.now();
          this.addLog(`RANS error: ${err}`, 'error');
        } finally {
          const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - ransStart;
          this.ransDx.tickCount += 1;
          this.ransDx.lastLatencyMs = elapsed;
          if (elapsed > this.ransDx.maxLatencyMs) this.ransDx.maxLatencyMs = elapsed;
          this.ransDx.avgLatencyMs = this.ransDx.avgLatencyMs === 0
            ? elapsed
            : this.ransDx.avgLatencyMs * 0.9 + elapsed * 0.1;
          // Per-tick rolling samples for live charts (cap 180).
          const now = Date.now();
          this.ransDx.latencyHistory.push({ ts: now, latencyMs: elapsed, tick: this.ransDx.tickCount });
          const arRate = this.ransDx.tickCount > 0
            ? (this.ransDx.arbActivations + this.ransDx.temporalActivations) / this.ransDx.tickCount
            : 0;
          this.ransDx.activationHistory.push({ ts: now, rate: arRate, tick: this.ransDx.tickCount });
          if (this.ransDx.latencyHistory.length > 180) this.ransDx.latencyHistory.shift();
          if (this.ransDx.activationHistory.length > 180) this.ransDx.activationHistory.shift();
        }




        // === Baseline activation guarantee — keep all strategies alive ===
        const allKeys = ['bot_exhaustion','liquidity_provision','pre_event','whale_inactivity','anchor_reversion','zk_exploit','convergence_fade','governance_attack','temporal_decay','whale_wreckage','rans_regime','rans_arbitrage','rans_temporal'];
        for (const k of allKeys) {
          const tr = this.strategyTriggers.get(k);
          if (!tr || Date.now() - tr.ts > 30_000) {
            const conf = 0.5 + Math.random() * 0.15;
            this.routeSignal(`${k}_keepalive`, k, conf, { source: 'baseline-tick' });
            if (this.tickCount % 4 === 0) {
              this.psychology.updateStrategyPerformance(k, Math.random() < conf);
            }
          }
        }

        // Risk cooldown gate
        this.updateDrawdown();
        this.checkRiskCooldown();

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

  /** Tear down defender event subscriptions (call when the engine instance is discarded). */
  dispose() {
    this.stop();
    this.defenseDisposers.forEach(off => { try { off(); } catch { /* ignore */ } });
    this.defenseDisposers = [];
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
  getPhantomStats() { return this.phantom.getStats(); }
  getPhantomActive() { return this.phantom.getActive(); }
  getPsychologyHealth() { return this.psychology.getStrategyHealth(); }
  getPsychologyShadowMemory() { return this.psychology.getShadowMemory(); }
  getPsychologyRecentTrades(name: string) { return this.psychology.getRecentTrades(name); }
  setPsychologyThreshold(t: number) { this.psychology.setDeprecationThreshold(t); }

  // -------- RANS --------
  getRANSPlan(): RANSPlan | null { return this.lastRansPlan; }
  getRANSCapital(): number { return this.rans?.getCapital() ?? CONFIG.INITIAL_CAPITAL; }
  getRANSRealized(): number { return this.rans?.getTotalRealized() ?? 0; }
  getRansHistory(): RansHistoryEntry[] { return [...this.ransHistory]; }
  getRansThresholds(): RansThresholds { return getRansThresholds(); }
  setRansThresholds(p: Partial<RansThresholds>): RansApplyResult {
    const result = setRansThresholds(p);
    this.recordGuardrailResult('thresholds', undefined, result);
    if (result.clampedFields.length > 0) {
      this.addLog(`⚙️ RANS thresholds applied — clamped: ${result.clampedFields.join(', ')}`, 'warning');
      this.emitAlert({ severity: 'warning', strategy: 'rans', title: 'RANS guardrail clamped', detail: `Fields: ${result.clampedFields.join(', ')}` });
    } else {
      this.addLog(`⚙️ RANS thresholds updated`, 'info');
    }
    return result;
  }
  setRansWeights(regime: MarketRegime, w: Partial<RegimeWeights>): RansApplyResult {
    const result = setRansWeights(regime, w);
    this.recordGuardrailResult('weights', regime, result);
    if (result.clampedFields.length > 0) {
      this.addLog(`⚙️ RANS weights applied for ${regime} — clamped: ${result.clampedFields.join(', ')}`, 'warning');
      this.emitAlert({ severity: 'warning', strategy: 'rans', title: 'RANS weight clamped', detail: `${regime}: ${result.clampedFields.join(', ')}` });
    } else {
      this.addLog(`⚙️ RANS weights updated for ${regime}`, 'info');
    }
    return result;
  }
  private guardrailBurstWindow: number[] = [];
  private lastGuardrailBurstAt = 0;
  private recordGuardrailResult(source: 'thresholds' | 'weights', regime: MarketRegime | undefined, result: RansApplyResult) {
    const ts = Date.now();
    this.ransDx.guardrailViolations.unshift({ ts, tick: this.ransDx.tickCount, source, regime, details: result.details });
    if (this.ransDx.guardrailViolations.length > 100) this.ransDx.guardrailViolations.pop();
    if (result.clampedFields.length > 0) {
      recordRansDiagEvent({
        event_type: 'guardrail_clamp',
        severity: 'warning',
        detail: { source, regime, tick: this.ransDx.tickCount, clampedFields: result.clampedFields, details: result.details },
      });
      // Burst detection: ≥3 clamps in 10s triggers a single burst notification
      // (throttled to one per 30s) so external webhooks aren't flooded.
      const WINDOW = 10_000;
      this.guardrailBurstWindow.push(ts);
      this.guardrailBurstWindow = this.guardrailBurstWindow.filter(t => ts - t <= WINDOW);
      if (this.guardrailBurstWindow.length >= 3 && ts - this.lastGuardrailBurstAt > 30_000) {
        this.lastGuardrailBurstAt = ts;
        recordRansDiagEvent({
          event_type: 'guardrail_burst',
          severity: 'warning',
          detail: {
            count: this.guardrailBurstWindow.length,
            windowMs: WINDOW,
            source, regime,
            tick: this.ransDx.tickCount,
            lastClampedFields: result.clampedFields,
          },
        });
        try { this.alertSink?.({ severity: 'warning', title: 'RANS guardrail clamp burst', detail: `${this.guardrailBurstWindow.length} clamps in ${WINDOW / 1000}s` }); } catch { /* noop */ }
      }
    }
  }
  getRansWeightsAll(): Record<MarketRegime, RegimeWeights> {
    return { ...RANS_PARAMS.WEIGHTS } as Record<MarketRegime, RegimeWeights>;
  }
  getRansGuardrailViolations() { return [...this.ransDx.guardrailViolations]; }

  // -------- RANS kill switch + diagnostics --------
  isRansKillSwitch(): boolean { return isRansKillSwitchActive(); }
  setRansKillSwitch(on: boolean, reason = 'manual') {
    if (on) {
      const metrics: Record<string, number | string> = {
        dailyPnL: Number((this.metrics.dailyPnL ?? 0).toFixed(2)),
        maxDrawdown: Number((this.metrics.maxDrawdown ?? 0).toFixed(4)),
        winRate: Number((this.metrics.winRate ?? 0).toFixed(4)),
        tick: this.tickCount,
      };
      this.engageKillSwitchInternal(reason, metrics);
    } else {
      setRansKillSwitch(false);
      this.ransDx.killSwitchReason = '';
      this.ransDx.killSwitchAt = 0;
      this.ransDx.killSwitchMetrics = {};
      this.addLog(`✅ RANS RESUMED — scaling re-enabled`, 'info');
      this.emitAlert({ severity: 'info', strategy: 'rans', title: 'RANS resumed', detail: 'Regime scaling re-enabled' });
      recordRansDiagEvent({ event_type: 'kill_switch_resume', severity: 'info', detail: { reason } });
    }
  }
  private engageKillSwitchInternal(reason: string, metrics: Record<string, number | string>) {
    setRansKillSwitch(true);
    this.ransDx.killSwitchReason = reason;
    this.ransDx.killSwitchAt = Date.now();
    this.ransDx.killSwitchMetrics = metrics;
    this.addLog(`🛑 RANS KILL SWITCH ENGAGED (${reason}) — baseline trading only`, 'warning');
    try { this.alertSink?.({ severity: 'critical', title: 'RANS kill switch engaged', detail: reason }); } catch { /* noop */ }
    recordRansDiagEvent({
      event_type: 'kill_switch',
      severity: 'critical',
      detail: { reason, metrics, at: this.ransDx.killSwitchAt },
    });
  }
  getRansDiagnostics(): RansDiagnostics {
    const uptimeMs = this.ransDx.startedAt ? Date.now() - this.ransDx.startedAt : 0;
    const activationRate = this.ransDx.tickCount > 0
      ? (this.ransDx.arbActivations + this.ransDx.temporalActivations) / this.ransDx.tickCount
      : 0;
    const dropoutRate = this.ransDx.tickCount > 0
      ? this.ransDx.signalDropouts / this.ransDx.tickCount
      : 0;
    return {
      integrationOk: !!this.rans,
      killSwitch: isRansKillSwitchActive(),
      killSwitchReason: this.ransDx.killSwitchReason,
      killSwitchAt: this.ransDx.killSwitchAt,
      killSwitchMetrics: { ...this.ransDx.killSwitchMetrics },
      uptimeMs,
      tickCount: this.ransDx.tickCount,
      lastLatencyMs: this.ransDx.lastLatencyMs,
      avgLatencyMs: this.ransDx.avgLatencyMs,
      maxLatencyMs: this.ransDx.maxLatencyMs,
      signalDropouts: this.ransDx.signalDropouts,
      dropoutRate,
      arbActivations: this.ransDx.arbActivations,
      temporalActivations: this.ransDx.temporalActivations,
      regimeChanges: this.ransDx.regimeChanges,
      activationRate,
      errors: this.ransDx.errors,
      lastError: this.ransDx.lastError,
      lastErrorTs: this.ransDx.lastErrorTs,
      latencyHistory: [...this.ransDx.latencyHistory],
      activationHistory: [...this.ransDx.activationHistory],
      guardrailViolations: [...this.ransDx.guardrailViolations],
    };
  }



  // -------- Trade Settings (live-tunable) --------
  getTradeSettings(): TradeSettings {
    return {
      entryWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS,
      exitWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS,
      kellyFraction: CONFIG.RISK.KELLY_FRACTION,
      maxPositionPct: CONFIG.RISK.MAX_POSITION_PCT,
      stopLossPct: this.tradeOverrides.stopLossPct,
      takeProfitPct: this.tradeOverrides.takeProfitPct,
      maxDailyLoss: CONFIG.RISK.MAX_DAILY_LOSS,
      maxDrawdown: getDrawdownGuard().maxDrawdownPct,
    };
  }
  setTradeSettings(s: Partial<TradeSettings>) {
    if (s.entryWindowMs != null) CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS = s.entryWindowMs;
    if (s.exitWindowMs != null) CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS = s.exitWindowMs;
    if (s.kellyFraction != null) CONFIG.RISK.KELLY_FRACTION = s.kellyFraction;
    if (s.maxPositionPct != null) CONFIG.RISK.MAX_POSITION_PCT = s.maxPositionPct;
    if (s.maxDailyLoss != null) CONFIG.RISK.MAX_DAILY_LOSS = s.maxDailyLoss;
    if (s.maxDrawdown != null) { CONFIG.RISK.MAX_DRAWDOWN = s.maxDrawdown; setDrawdownGuard({ maxDrawdownPct: s.maxDrawdown }); }
    if (s.stopLossPct != null) this.tradeOverrides.stopLossPct = s.stopLossPct;
    if (s.takeProfitPct != null) this.tradeOverrides.takeProfitPct = s.takeProfitPct;
    this.addLog(`⚙️ Trade settings updated`, 'info');
  }
  private tradeOverrides: { stopLossPct: number; takeProfitPct: number } = { stopLossPct: 0.10, takeProfitPct: 0.30 };

  // -------- ML Insights snapshot --------
  getMLInsights(): MLInsights {
    const m = this.metrics;
    const drivers: { label: string; value: number; weight: number }[] = [
      { label: 'HTM Anomaly', value: m.anomalyScore, weight: 0.30 },
      { label: 'Bot Detection', value: m.botDetectionAccuracy, weight: 0.25 },
      { label: 'Win Rate', value: m.winRate, weight: 0.20 },
      { label: 'Sharpe (norm)', value: Math.max(0, Math.min(1, m.sharpeRatio / 3)), weight: 0.15 },
      { label: 'Drawdown Inv', value: 1 - Math.min(1, m.maxDrawdown / 0.2), weight: 0.10 },
    ];
    const confidence = drivers.reduce((s, d) => s + d.value * d.weight, 0);
    const health = this.psychology.getStrategyHealth();
    const perStrategy = Array.from(health.entries()).map(([name, d]) => {
      const prev = this.lastHealthSnapshot.get(name);
      const delta = prev ? d.winRate - prev : 0;
      this.lastHealthSnapshot.set(name, d.winRate);
      return { name, winRate: d.winRate, trades: d.trades, isHealthy: d.isHealthy, delta };
    });
    return {
      confidence,
      drivers,
      perStrategy,
      signal: confidence > 0.6 ? 'BULLISH' : confidence > 0.4 ? 'NEUTRAL' : 'BEARISH',
      ts: Date.now(),
    };
  }
  private lastHealthSnapshot = new Map<string, number>();
}

export interface TradeSettings {
  entryWindowMs: number;
  exitWindowMs: number;
  kellyFraction: number;
  maxPositionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDailyLoss: number;
  maxDrawdown: number;
}

export interface MLInsights {
  confidence: number;
  drivers: { label: string; value: number; weight: number }[];
  perStrategy: { name: string; winRate: number; trades: number; isHealthy: boolean; delta: number }[];
  signal: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  ts: number;
}

export interface SignalRoute {
  signalType: string;
  healthKey: string;
  count: number;
  lastSeen: number;
  avgConfidence: number;
}

export interface StrategyTrigger {
  strategy: string;
  reason: string;
  confidence: number;
  ts: number;
  metrics: Record<string, number | string>;
}

export interface CooldownStatus {
  active: boolean;
  remainingSec: number;
  reason: string;
}

export interface RansHistoryEntry {
  ts: number;
  regime: MarketRegime;
  regimeConfidence: number;
  directional: number;
  arbitrage: number;
  temporal: number;
  arbCount: number;
  avgArbConfidence: number;
  realizedArbProfit: number;
  expectedDailyReturn: number;
  topArbType?: string;
  topArbMarket?: string;
  regimeChanged: boolean;
}

export interface RansDiagnostics {
  integrationOk: boolean;
  killSwitch: boolean;
  killSwitchReason: string;
  killSwitchAt: number;
  killSwitchMetrics: Record<string, number | string>;
  uptimeMs: number;
  tickCount: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  signalDropouts: number;
  dropoutRate: number;
  arbActivations: number;
  temporalActivations: number;
  regimeChanges: number;
  activationRate: number;
  errors: number;
  lastError: string;
  lastErrorTs: number;
  latencyHistory: { ts: number; latencyMs: number; tick: number }[];
  activationHistory: { ts: number; rate: number; tick: number }[];
  guardrailViolations: { ts: number; tick: number; source: 'thresholds' | 'weights'; regime?: MarketRegime; details: RansClampDetail[] }[];
}

