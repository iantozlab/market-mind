// ============================================
// Regime-Adaptive Neural Scaling (RANS)
// Proprietary formula — wired into UnifiedNeuralBot.
// Operates on live Market[] + flattened Trade[] from the bot's data fetcher.
// ============================================

import type { Market, Trade } from './neural-bot-engine';

// MUTABLE runtime config — dashboard controls update these values live.
export const RANS_PARAMS = {
  HIGH_VOLATILITY_THRESHOLD: 0.03,
  LOW_VOLATILITY_THRESHOLD: 0.01,
  MOMENTUM_PERSISTENCE_THRESHOLD: 0.6,
  EVENT_VOLUME_SPIKE_THRESHOLD: 3.0,

  WEIGHTS: {
    trending:         { directional: 0.50, arbitrage: 0.20, temporal: 0.30 },
    mean_reverting:   { directional: 0.30, arbitrage: 0.40, temporal: 0.30 },
    high_volatility:  { directional: 0.20, arbitrage: 0.60, temporal: 0.20 },
    low_volatility:   { directional: 0.60, arbitrage: 0.20, temporal: 0.20 },
    event_driven:     { directional: 0.70, arbitrage: 0.10, temporal: 0.20 },
  },

  MIN_REBALANCING_PROFIT: 0.02,
  MIN_COMBINATORIAL_PROFIT: 0.03,
  MAX_ARBITRAGE_POSITION_PCT: 0.25,

  OPTIMAL_ENTRY_START_DAYS: 30,
  OPTIMAL_ENTRY_END_DAYS: 7,
  OPTIMAL_EXIT_START_DAYS: 6,
  OPTIMAL_EXIT_END_DAYS: 5,

  TARGET_WIN_RATE: 0.85,
  MAX_DRAWDOWN: 0.08,
  SHARPE_TARGET: 3.0,

  // Configurable confidence floor for arbitrage signals; alerts below this.
  MIN_ARB_CONFIDENCE: 0.45,
};

export type MarketRegime =
  | 'trending'
  | 'mean_reverting'
  | 'high_volatility'
  | 'low_volatility'
  | 'event_driven';

export interface RegimeWeights {
  directional: number;
  arbitrage: number;
  temporal: number;
}

export interface ArbitrageSignal {
  type: 'REBALANCING' | 'COMBINATORIAL' | 'CROSS_MARKET';
  marketId: string;
  marketSlug?: string;
  relatedMarkets?: string[];
  action: 'BUY_BOTH' | 'SELL_BOTH' | 'BUY_ALL' | 'SELL_ALL' | 'HEDGE';
  profitGuaranteed: number;
  confidence: number;
  requiredCapital: number;
  expectedReturn: number;
}

export interface TemporalWindow {
  marketId: string;
  phase: 'entry' | 'hold' | 'exit' | 'danger' | 'idle';
  daysToExpiry: number;
  confidence: number;
  expectedReturn: number;
}

export interface RANSPlan {
  regime: MarketRegime;
  regimeConfidence: number;
  weights: RegimeWeights;
  arbitrageSignals: ArbitrageSignal[];
  temporalWindows: TemporalWindow[];
  directionalConfidence: number;
  expectedDailyReturn: number;
  realizedArbitrageProfit: number;
  avgArbConfidence: number;
  ts: number;
}

// Live-tunable runtime helpers consumed by the dashboard controls.
export interface RansThresholds {
  highVolatility: number;
  lowVolatility: number;
  momentumPersistence: number;
  eventVolumeSpike: number;
  minArbConfidence: number;
}
export function getRansThresholds(): RansThresholds {
  return {
    highVolatility: RANS_PARAMS.HIGH_VOLATILITY_THRESHOLD,
    lowVolatility: RANS_PARAMS.LOW_VOLATILITY_THRESHOLD,
    momentumPersistence: RANS_PARAMS.MOMENTUM_PERSISTENCE_THRESHOLD,
    eventVolumeSpike: RANS_PARAMS.EVENT_VOLUME_SPIKE_THRESHOLD,
    minArbConfidence: RANS_PARAMS.MIN_ARB_CONFIDENCE,
  };
}
export function setRansThresholds(p: Partial<RansThresholds>) {
  if (p.highVolatility != null) RANS_PARAMS.HIGH_VOLATILITY_THRESHOLD = p.highVolatility;
  if (p.lowVolatility != null) RANS_PARAMS.LOW_VOLATILITY_THRESHOLD = p.lowVolatility;
  if (p.momentumPersistence != null) RANS_PARAMS.MOMENTUM_PERSISTENCE_THRESHOLD = p.momentumPersistence;
  if (p.eventVolumeSpike != null) RANS_PARAMS.EVENT_VOLUME_SPIKE_THRESHOLD = p.eventVolumeSpike;
  if (p.minArbConfidence != null) RANS_PARAMS.MIN_ARB_CONFIDENCE = p.minArbConfidence;
}
export function setRansWeights(regime: MarketRegime, w: Partial<RegimeWeights>) {
  const cur = RANS_PARAMS.WEIGHTS[regime];
  const next = { ...cur, ...w };
  // Re-normalize so directional + arbitrage + temporal = 1
  const sum = next.directional + next.arbitrage + next.temporal;
  if (sum > 0) {
    RANS_PARAMS.WEIGHTS[regime] = {
      directional: next.directional / sum,
      arbitrage: next.arbitrage / sum,
      temporal: next.temporal / sum,
    };
  }
}

// -------- Regime detector --------
class RegimeDetector {
  private regimeHistory: MarketRegime[] = [];

  detect(markets: Market[], trades: Trade[]): { regime: MarketRegime; confidence: number; metrics: Record<string, number> } {
    const volatility = this.calcVolatility(markets, trades);
    const momentum = this.calcMomentum(markets, trades);
    const volumeSpike = this.detectVolumeSpike(trades);
    const eventDriven = this.detectEvent(markets, trades);

    let regime: MarketRegime;
    if (eventDriven || volumeSpike > RANS_PARAMS.EVENT_VOLUME_SPIKE_THRESHOLD) regime = 'event_driven';
    else if (volatility > RANS_PARAMS.HIGH_VOLATILITY_THRESHOLD) regime = 'high_volatility';
    else if (volatility < RANS_PARAMS.LOW_VOLATILITY_THRESHOLD) regime = 'low_volatility';
    else if (momentum > RANS_PARAMS.MOMENTUM_PERSISTENCE_THRESHOLD) regime = 'trending';
    else regime = 'mean_reverting';

    this.regimeHistory.push(regime);
    if (this.regimeHistory.length > 50) this.regimeHistory.shift();

    const recent = this.regimeHistory.slice(-5);
    const stable = recent.length >= 3 && new Set(recent).size === 1;
    const confidence = stable ? 0.9 : recent.length < 3 ? 0.65 : 0.7;

    return { regime, confidence, metrics: { volatility, momentum, volumeSpike } };
  }

  private calcVolatility(markets: Market[], trades: Trade[]): number {
    let total = 0, n = 0;
    for (const m of markets) {
      const mt = trades.filter(t => t.marketId === m.id).slice(0, 100);
      if (mt.length < 10) continue;
      const rets: number[] = [];
      for (let i = 1; i < mt.length; i++) {
        const prev = mt[i - 1].price || 0.5;
        rets.push((mt[i].price - prev) / prev);
      }
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length;
      total += Math.sqrt(variance);
      n++;
    }
    return n > 0 ? total / n : 0.02;
  }

  private calcMomentum(markets: Market[], trades: Trade[]): number {
    let same = 0, total = 0;
    for (const m of markets) {
      const mt = trades.filter(t => t.marketId === m.id).slice(0, 100);
      for (let i = 2; i < mt.length; i++) {
        const p = mt[i - 1].price - mt[i - 2].price;
        const c = mt[i].price - mt[i - 1].price;
        if (p * c > 0) same++;
        total++;
      }
    }
    return total > 0 ? same / total : 0.5;
  }

  private detectVolumeSpike(trades: Trade[]): number {
    const now = Date.now();
    const recent = trades.filter(t => now - t.timestamp < 300_000);
    const prev = trades.filter(t => {
      const age = now - t.timestamp;
      return age >= 300_000 && age < 600_000;
    });
    const rv = recent.reduce((s, t) => s + t.amount, 0);
    const pv = prev.reduce((s, t) => s + t.amount, 0);
    return pv > 0 ? rv / pv : 1;
  }

  private detectEvent(markets: Market[], trades: Trade[]): boolean {
    const changes: number[] = [];
    for (const m of markets) {
      const mt = trades.filter(t => t.marketId === m.id).slice(0, 20);
      if (mt.length > 5) {
        changes.push(Math.abs(mt[0].price - mt[mt.length - 1].price));
      }
    }
    if (changes.length === 0) return false;
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    return avg > 0.05;
  }
}

// -------- Arbitrage detector --------
class ArbitrageDetector {
  detect(markets: Market[], capital: number): ArbitrageSignal[] {
    const signals: ArbitrageSignal[] = [];

    for (const m of markets) {
      const sum = (m.outcomePrices[0] ?? 0) + (m.outcomePrices[1] ?? 0);
      const dev = Math.abs(sum - 1.0);
      if (dev > RANS_PARAMS.MIN_REBALANCING_PROFIT) {
        const req = Math.min(capital * 0.1, 5000);
        signals.push({
          type: 'REBALANCING',
          marketId: m.id,
          marketSlug: m.slug,
          action: sum < 1.0 ? 'BUY_BOTH' : 'SELL_BOTH',
          profitGuaranteed: dev,
          confidence: Math.min(0.99, 0.85 + dev * 2),
          requiredCapital: req,
          expectedReturn: req * dev,
        });
      }
    }

    const byCat = new Map<string, Market[]>();
    for (const m of markets) {
      const cat = m.category || 'misc';
      const arr = byCat.get(cat) || [];
      arr.push(m);
      byCat.set(cat, arr);
    }
    for (const [cat, group] of byCat) {
      if (group.length < 2) continue;
      const totalProb = group.reduce((s, m) => s + (m.outcomePrices[0] ?? 0), 0);
      const dev = Math.abs(totalProb - 1.0);
      if (dev > RANS_PARAMS.MIN_COMBINATORIAL_PROFIT && dev < 0.5) {
        const req = Math.min(capital * 0.15, 10000);
        signals.push({
          type: 'COMBINATORIAL',
          marketId: group[0].id,
          marketSlug: `${cat}:${group.length} markets`,
          relatedMarkets: group.slice(1).map(m => m.id),
          action: totalProb < 1.0 ? 'BUY_ALL' : 'SELL_ALL',
          profitGuaranteed: dev,
          confidence: 0.88,
          requiredCapital: req,
          expectedReturn: req * dev * 0.5,
        });
      }
    }

    return signals.sort((a, b) => b.expectedReturn - a.expectedReturn).slice(0, 8);
  }
}

// -------- Temporal positioning (30-Day Rule) --------
class TemporalEngine {
  calculate(market: Market): TemporalWindow {
    const end = new Date(market.endDate).getTime();
    const hours = Math.max(0, (end - Date.now()) / 3_600_000);
    const days = hours / 24;

    let phase: TemporalWindow['phase'] = 'idle';
    let confidence = 0;
    let expectedReturn = 0;

    if (days > RANS_PARAMS.OPTIMAL_ENTRY_END_DAYS && days < RANS_PARAMS.OPTIMAL_ENTRY_START_DAYS) {
      phase = 'entry'; confidence = 0.85; expectedReturn = 0.08;
    } else if (days > RANS_PARAMS.OPTIMAL_EXIT_END_DAYS && days <= RANS_PARAMS.OPTIMAL_EXIT_START_DAYS) {
      phase = 'exit'; confidence = 0.80; expectedReturn = 0.05;
    } else if (days > RANS_PARAMS.OPTIMAL_EXIT_END_DAYS && days < RANS_PARAMS.OPTIMAL_ENTRY_END_DAYS) {
      phase = 'hold'; confidence = 0.70; expectedReturn = 0.04;
    } else if (hours < 6) {
      phase = 'danger'; confidence = 0.20; expectedReturn = 0.01;
    } else {
      phase = 'idle'; confidence = 0.35; expectedReturn = 0.01;
    }

    return { marketId: market.id, phase, daysToExpiry: days, confidence, expectedReturn };
  }
}

// -------- Execution engine --------
export class RANSExecutionEngine {
  private regimeDetector = new RegimeDetector();
  private arbDetector = new ArbitrageDetector();
  private temporal = new TemporalEngine();
  private capital: number;
  private realized = 0;
  private lastPlan: RANSPlan | null = null;

  constructor(capital: number) { this.capital = capital; }

  analyze(markets: Market[], trades: Trade[], directionalConfidence: number): RANSPlan {
    const { regime, confidence: regConf } = this.regimeDetector.detect(markets, trades);
    const weights = { ...RANS_PARAMS.WEIGHTS[regime] };

    const arbitrageSignals = this.arbDetector.detect(markets, this.capital);
    const temporalWindows = markets.slice(0, 12).map(m => this.temporal.calculate(m));

    let tickRealized = 0;
    for (const s of arbitrageSignals) {
      if (s.confidence > 0.85) {
        const size = Math.min(s.requiredCapital, this.capital * RANS_PARAMS.MAX_ARBITRAGE_POSITION_PCT);
        const gain = size * s.profitGuaranteed * 0.6;
        tickRealized += gain;
      }
    }
    this.realized += tickRealized;
    this.capital += tickRealized;

    const arbReturn = arbitrageSignals.reduce((s, a) => s + a.expectedReturn, 0);
    const dirReturn = directionalConfidence * 0.05;
    const tempReturn = (temporalWindows.reduce((s, w) => s + w.confidence, 0) / Math.max(1, temporalWindows.length)) * 0.03;
    const expectedDailyReturn =
      arbReturn * weights.arbitrage + dirReturn * weights.directional + tempReturn * weights.temporal;

    const avgArbConfidence = arbitrageSignals.length > 0
      ? arbitrageSignals.reduce((s, a) => s + a.confidence, 0) / arbitrageSignals.length
      : 0;

    const plan: RANSPlan = {
      regime,
      regimeConfidence: regConf,
      weights,
      arbitrageSignals,
      temporalWindows,
      directionalConfidence,
      expectedDailyReturn,
      realizedArbitrageProfit: tickRealized,
      avgArbConfidence,
      ts: Date.now(),
    };
    this.lastPlan = plan;
    return plan;
  }

  getCapital() { return this.capital; }
  getTotalRealized() { return this.realized; }
  getLastPlan() { return this.lastPlan; }
}
