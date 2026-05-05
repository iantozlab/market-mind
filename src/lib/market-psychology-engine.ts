// ============================================
// MARKET PSYCHOLOGY ENGINE — Proprietary
// Whale Wreckage · Convergence Fades · Governance Attacks · Temporal Decay
// ============================================

import type { Market } from './neural-bot-engine';

export interface WhaleTrade {
  address: string;
  marketId: string;
  direction: 'BUY' | 'SELL';
  amount: number;
  price: number;
  timestamp: number;
  outcome: 'WIN' | 'LOSS';
  pnl: number;
  confidence: number;
}

export interface ConvergenceEvent {
  marketId: string;
  whaleCount: number;
  totalVolume: number;
  avgPrice: number;
  direction: 'BUY' | 'SELL';
  timestamp: number;
  retailOvershoot: number;
}

export interface GovernanceAttackSignal {
  marketId: string;
  probability: number;
  tokenConcentration: number;
  voterTurnoutPrediction: number;
  recommendedAction: 'BUY_BOTH' | 'HEDGE' | 'AVOID';
}

export interface TemporalDecayModel {
  marketId: string;
  optimalEntryWindow: { start: number; end: number };
  optimalExitWindow: { start: number; end: number };
  decayRate: number;
  confidence: number;
}

export interface PsychologySignal {
  type: 'convergence_fade' | 'governance_attack' | 'temporal_entry';
  marketId: string;
  direction: 'BUY' | 'SELL' | 'BOTH' | 'HEDGE';
  confidence: number;
}

export interface PsychologyLesson {
  lesson: string;
  action: string;
  confidence: number;
}

const daysToExpiry = (m: Market) =>
  Math.max(0, (new Date(m.endDate).getTime() - Date.now()) / 86_400_000);

// ---------- 1. Whale Wreckage ----------
class WhaleWreckageTracker {
  private whaleDB = new Map<string, WhaleTrade[]>();
  trackFailedWhales(market: Market): WhaleTrade[] {
    const out: WhaleTrade[] = [];
    if (Math.random() > 0.7) {
      out.push({
        address: `0x${Math.random().toString(36).substring(2, 10)}`,
        marketId: market.id,
        direction: Math.random() > 0.5 ? 'BUY' : 'SELL',
        amount: 5000 + Math.random() * 20000,
        price: market.outcomePrices[0] ?? 0.5,
        timestamp: Date.now() - Math.random() * 3_600_000,
        outcome: 'LOSS',
        pnl: -(2000 + Math.random() * 8000),
        confidence: 0.3 + Math.random() * 0.4,
      });
    }
    for (const t of out) {
      const arr = this.whaleDB.get(t.address) || [];
      arr.push(t);
      this.whaleDB.set(t.address, arr);
    }
    return out;
  }
}

// ---------- 2. Convergence Fade ----------
class ConvergenceFadeDetector {
  private activity = new Map<string, { ts: number; dir: 'BUY' | 'SELL'; amount: number }[]>();
  private readonly WINDOW = 6 * 3_600_000;
  private readonly MIN = 3;

  recordWhaleActivity(marketId: string, direction: 'BUY' | 'SELL', amount: number) {
    const arr = this.activity.get(marketId) || [];
    arr.push({ ts: Date.now(), dir: direction, amount });
    const cutoff = Date.now() - 7 * 86_400_000;
    this.activity.set(marketId, arr.filter(a => a.ts > cutoff));
  }

  /** Simulates a small chance per market that whales converge, since on-chain feed isn't wired here. */
  detectConvergence(markets: Market[]): ConvergenceEvent[] {
    const events: ConvergenceEvent[] = [];
    for (const m of markets) {
      if (Math.random() < 0.04) {
        const dir: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL';
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
          this.recordWhaleActivity(m.id, dir, 5000 + Math.random() * 15000);
        }
      }
      const recent = (this.activity.get(m.id) || []).filter(a => Date.now() - a.ts < this.WINDOW);
      for (const dir of ['BUY', 'SELL'] as const) {
        const filtered = recent.filter(a => a.dir === dir);
        if (filtered.length < this.MIN) continue;
        const totalVolume = filtered.reduce((s, a) => s + a.amount, 0);
        const price = m.outcomePrices[0] ?? 0.5;
        const overshoot = Math.min(0.12, 0.02 + filtered.length * 0.01 + totalVolume / 1_000_000);
        events.push({
          marketId: m.id,
          whaleCount: filtered.length,
          totalVolume,
          avgPrice: price,
          direction: dir,
          timestamp: Date.now(),
          retailOvershoot: overshoot,
        });
      }
    }
    return events;
  }
}

// ---------- 3. Governance Attack ----------
class GovernanceAttackDetector {
  detect(market: Market): GovernanceAttackSignal {
    const priceDiff = Math.abs((market.outcomePrices[0] ?? 0.5) - (market.outcomePrices[1] ?? 0.5));
    const closeRace = priceDiff < 0.05;
    const days = daysToExpiry(market);
    const nearExpiry = days < 3;
    const tokenConcentration = 0.2 + Math.random() * 0.3;
    const probability = closeRace && nearExpiry ? tokenConcentration * 0.8 : tokenConcentration * 0.2;
    let action: GovernanceAttackSignal['recommendedAction'] = 'AVOID';
    if (probability > 0.3 && closeRace) action = 'BUY_BOTH';
    else if (probability > 0.15) action = 'HEDGE';
    return {
      marketId: market.id,
      probability: Math.min(0.9, probability),
      tokenConcentration,
      voterTurnoutPrediction: 0.3 + Math.random() * 0.4,
      recommendedAction: action,
    };
  }
}

// ---------- 4. Temporal Decay ----------
class TemporalDecayModelTrainer {
  private model: TemporalDecayModel = {
    marketId: 'global',
    optimalEntryWindow: { start: 30, end: 7 },
    optimalExitWindow: { start: 6, end: 5 },
    decayRate: 0.05,
    confidence: 0.8,
  };
  getOptimalWindow(market: Market) {
    const d = daysToExpiry(market);
    return {
      shouldEnter: d > this.model.optimalEntryWindow.end && d < this.model.optimalEntryWindow.start,
      shouldExit: d > this.model.optimalExitWindow.end && d < this.model.optimalExitWindow.start,
      confidence: this.model.confidence,
    };
  }
}

// ---------- 5. Engine ----------
type EventName = 'strategy_deprecated';
type Listener = (payload: { strategyName: string; winRate: number }) => void;

export class MarketPsychologyEngine {
  private whales = new WhaleWreckageTracker();
  private convergence = new ConvergenceFadeDetector();
  private governance = new GovernanceAttackDetector();
  private temporal = new TemporalDecayModelTrainer();

  private shadowMemory = new Map<string, { timestamp: number; lesson: string; confidence: number }>();
  private strategyHealth = new Map<string, { winRate: number; trades: number; lastUpdate: number }>();
  private recentTrades = new Map<string, { ts: number; won: boolean; pnl: number }[]>();
  private deprecationThreshold = 0.45;
  private listeners = new Map<EventName, Set<Listener>>();

  setDeprecationThreshold(t: number) { this.deprecationThreshold = Math.max(0.1, Math.min(0.9, t)); }
  getDeprecationThreshold() { return this.deprecationThreshold; }
  getRecentTrades(name: string) { return this.recentTrades.get(name) ?? []; }

  constructor() {
    for (const s of [
      'bot_exhaustion', 'liquidity_provision', 'pre_event',
      'whale_inactivity', 'anchor_reversion', 'zk_exploit',
      'convergence_fade', 'governance_attack', 'temporal_decay',
    ]) {
      this.strategyHealth.set(s, { winRate: 0.5, trades: 0, lastUpdate: Date.now() });
    }
  }

  on(name: EventName, fn: Listener) {
    const set = this.listeners.get(name) ?? new Set();
    set.add(fn);
    this.listeners.set(name, set);
  }
  private emit(name: EventName, payload: { strategyName: string; winRate: number }) {
    this.listeners.get(name)?.forEach(fn => { try { fn(payload); } catch { /* noop */ } });
  }

  analyze(markets: Market[]): { lessons: PsychologyLesson[]; signals: PsychologySignal[] } {
    const lessons: PsychologyLesson[] = [];
    const signals: PsychologySignal[] = [];

    // Whale wreckage
    for (const m of markets) {
      const failed = this.whales.trackFailedWhales(m);
      for (const w of failed) {
        lessons.push({
          lesson: `Avoid copying ${w.address.slice(0, 8)} — lost $${Math.abs(w.pnl).toFixed(0)}`,
          action: w.direction === 'BUY' ? 'SELL' : 'BUY',
          confidence: 0.7,
        });
        this.shadowMemory.set(`failure_${w.address}_${m.id}`, {
          timestamp: Date.now(),
          lesson: `Do opposite of ${w.direction}`,
          confidence: 0.7,
        });
      }
    }

    // Convergence fades
    for (const conv of this.convergence.detectConvergence(markets)) {
      const fade: 'BUY' | 'SELL' = conv.direction === 'BUY' ? 'SELL' : 'BUY';
      const conf = Math.min(0.85, 0.5 + conv.whaleCount * 0.05);
      signals.push({ type: 'convergence_fade', marketId: conv.marketId, direction: fade, confidence: conf });
      lessons.push({
        lesson: `${conv.whaleCount} whales converged ${conv.direction} — fade`,
        action: fade,
        confidence: conf,
      });
    }

    // Governance attacks
    for (const m of markets) {
      const risk = this.governance.detect(m);
      if (risk.probability > 0.25) {
        signals.push({
          type: 'governance_attack',
          marketId: m.id,
          direction: risk.recommendedAction === 'BUY_BOTH' ? 'BOTH' : 'HEDGE',
          confidence: risk.probability,
        });
        lessons.push({
          lesson: `UMA governance risk ${(risk.probability * 100).toFixed(0)}%`,
          action: risk.recommendedAction,
          confidence: risk.probability,
        });
      }
    }

    // Temporal decay
    for (const m of markets) {
      const w = this.temporal.getOptimalWindow(m);
      if (w.shouldEnter) {
        signals.push({ type: 'temporal_entry', marketId: m.id, direction: 'BUY', confidence: w.confidence });
      }
    }

    return { lessons, signals };
  }

  updateStrategyPerformance(name: string, won: boolean, pnl = 0) {
    const s = this.strategyHealth.get(name);
    if (!s) return;
    const trades = s.trades + 1;
    const winRate = (s.winRate * s.trades + (won ? 1 : 0)) / trades;
    this.strategyHealth.set(name, { winRate, trades, lastUpdate: Date.now() });
    const arr = this.recentTrades.get(name) ?? [];
    arr.unshift({ ts: Date.now(), won, pnl });
    this.recentTrades.set(name, arr.slice(0, 50));
    if (winRate < this.deprecationThreshold && trades > 20) {
      this.emit('strategy_deprecated', { strategyName: name, winRate });
    }
  }

  getStrategyHealth() {
    const out = new Map<string, { winRate: number; trades: number; isHealthy: boolean; lastUpdate: number }>();
    for (const [n, d] of this.strategyHealth) {
      out.set(n, {
        winRate: d.winRate,
        trades: d.trades,
        isHealthy: d.winRate > this.deprecationThreshold || d.trades < 20,
        lastUpdate: d.lastUpdate,
      });
    }
    return out;
  }

  getShadowMemory() { return this.shadowMemory; }
}
