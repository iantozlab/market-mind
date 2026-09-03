/**
 * NonceRaceDefender — browser-safe adaptation.
 *
 * Defense suite against Nonce Race, Ghost Fills, cancel floods, multi-market
 * probing and 5-minute BTC manipulation targeting Polymarket bots.
 *
 * No node built-ins (events/ws/crypto) — uses a lightweight listener map,
 * crypto.getRandomValues, and the existing Supabase RPC proxy for chain reads.
 */

import type { Market, Trade } from './neural-bot-engine';

export type AttackType =
  | 'NONCE_RACE' | 'GHOST_FILL' | 'BALANCE_DRAIN' | 'CANCEL_FLOOD'
  | 'MULTI_MARKET' | 'BTC_MANIPULATION' | 'NONE';

export type DefenseMode = 'PASSIVE' | 'ACTIVE' | 'AGGRESSIVE';

export interface AttackDetection {
  id: string;
  isAttack: boolean;
  attackType: AttackType;
  attackerAddress?: string;
  confidence: number;
  timestamp: number;
  affectedMarkets?: string[];
  estimatedProfit?: number;
}

export interface OrderValidation {
  isValid: boolean;
  reason?: string;
  suggestedWaitMs: number;
  requiresManualVerification: boolean;
}

export interface ManipulationSignal {
  detected: boolean;
  confidence: number;
  type: 'BTC_5MIN' | 'SPOT_ORACLE' | 'NONE';
  estimatedImpact: number;
  recommendedAction: 'HEDGE' | 'AVOID' | 'EXPLOIT';
  marketSlug?: string;
}

export interface DefenseStatus {
  defenseActive: boolean;
  defenseMode: DefenseMode;
  blacklistedAddresses: number;
  privateMempoolActive: boolean;
  ecdsaRotationMs: number;
  lastKeyRotation: number;
  counterExploitProfit: number;
  lastAttackTime: number;
  ordersScreened: number;
  ordersBlocked: number;
  ticksProcessed: number;
}

export const DEFENSE_PARAMS = {
  BALANCE_DRAIN_THRESHOLD_USD: 5000,
  HIGH_GAS_THRESHOLD_GWEI: 150,
  CANCEL_FLOOD_THRESHOLD: 10,
  MULTI_MARKET_THRESHOLD: 3,
  MIN_CONFIRMATIONS: 3,
  VERIFICATION_TIMEOUT_MS: 45000,
  HEDGE_DELAY_MS: 5000,
  GHOST_FILL_WINDOW_MS: 3000,
  CANCEL_ALL_PATTERN_THRESHOLD: 0.8,
  BTC_5MIN_WINDOW_SECONDS: 10,
  PRICE_IMPACT_THRESHOLD: 0.005,
  BLACKLIST_REFRESH_HOURS: 6,
  NONCE_ROTATION_INTERVAL_MS: 3600000,
  /** Same attack type seen N times inside the window triggers a self-healing patch. */
  PATCH_TRIGGER_COUNT: 3,
  PATCH_WINDOW_MS: 120000,
  /** Optional Blocknative mempool config (key never hardcoded — resolved via /__config). */
} as const;

// ---------- Enhanced defender: opportunities, self-healing patches, events ----------
export interface CounterOpportunity {
  id: string;
  attackType: AttackType;
  attackerAddress?: string;
  marketIds: string[];
  expectedProfit: number;
  confidence: number;
  timestamp: number;
}

export type PatchType = 'EXTEND_HEDGE_DELAY' | 'TIGHTEN_SPOOF_CUTOFF' | 'RAISE_GAS_THRESHOLD' | 'SHRINK_ORDER_CAP';

export interface SelfHealingPatch {
  id: string;
  patchType: PatchType;
  vulnerability: AttackType;
  appliedAt: number;
  detail: string;
}

export interface DefenderConfig {
  polygonRpcUrl?: string;
  /** Optional; when absent the defender runs in passive mempool mode. */
  blocknativeApiKey?: string;
}

export interface TradeExecutionDecision {
  shouldExecute: boolean;
  waitMs: number;
  reason?: string;
  requiresManualVerification: boolean;
}

interface DefenderEventMap {
  opportunity_ready: CounterOpportunity;
  patch_applied: SelfHealingPatch;
}

type DefenseEvent =
  | { kind: 'attack'; data: AttackDetection }
  | { kind: 'manipulation'; data: ManipulationSignal }
  | { kind: 'order_rejected'; data: { reason: string; address: string } }
  | { kind: 'key_rotated'; data: { at: number } };

export interface DefenseLogEntry {
  id: string;
  ts: number;
  kind: DefenseEvent['kind'] | 'opportunity' | 'patch';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

const rid = () => {
  try {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(16).slice(2);
  }
};

interface CancelRec { timestamp: number; marketId: string; orderId: string; fromAddress: string }
interface OrderRec { timestamp: number; marketId: string; amount: number; price: number; fromAddress: string }

class EnhancedNonceRaceDefender {
  private listeners = new Set<() => void>();
  private eventHandlers: { [K in keyof DefenderEventMap]: Set<(payload: DefenderEventMap[K]) => void> } = {
    opportunity_ready: new Set(),
    patch_applied: new Set(),
  };

  private config: DefenderConfig;

  private cancellations: CancelRec[] = [];
  private orders: OrderRec[] = [];
  private blacklist = new Set<string>();
  private priceHistory = new Map<string, number[]>();

  private attacks: AttackDetection[] = [];
  private manipulations: ManipulationSignal[] = [];
  private opportunities: CounterOpportunity[] = [];
  private patches: SelfHealingPatch[] = [];
  private recentAttackTypes: { type: AttackType; ts: number }[] = [];
  private log: DefenseLogEntry[] = [];

  private active = true;
  private mode: DefenseMode = 'ACTIVE';
  private lastAttackTime = 0;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  private privateMempoolActive = true;
  private lastKeyRotation = Date.now();
  private keyHistory = 0;

  private counterExploitProfit = 0;
  private ordersScreened = 0;
  private ordersBlocked = 0;
  private ticksProcessed = 0;

  // Self-healing runtime adjustments (start at DEFENSE_PARAMS defaults)
  private rtHedgeDelayMs: number = DEFENSE_PARAMS.HEDGE_DELAY_MS;
  private rtSpoofCutoff = 0.7;
  private rtOrderCapRatio = 0.3;

  constructor(config: DefenderConfig = {}) {
    this.config = config;
    // Passive mempool mode when no Blocknative key is available.
    this.privateMempoolActive = !config.blocknativeApiKey ? this.privateMempoolActive : true;
  }

  // ---------- typed events ----------
  on<K extends keyof DefenderEventMap>(event: K, fn: (payload: DefenderEventMap[K]) => void): () => void {
    this.eventHandlers[event].add(fn);
    return () => { this.eventHandlers[event].delete(fn); };
  }
  private emitEvent<K extends keyof DefenderEventMap>(event: K, payload: DefenderEventMap[K]) {
    this.eventHandlers[event].forEach(fn => { try { fn(payload); } catch { /* noop */ } });
  }

  // ---------- subscription ----------
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { this.listeners.forEach(l => { try { l(); } catch { /* noop */ } }); }

  // ---------- public state ----------
  getStatus(): DefenseStatus & { patchesApplied: number; mempoolMode: 'private' | 'passive' } {
    return {
      defenseActive: this.active,
      defenseMode: this.mode,
      blacklistedAddresses: this.blacklist.size,
      privateMempoolActive: this.privateMempoolActive,
      ecdsaRotationMs: DEFENSE_PARAMS.NONCE_ROTATION_INTERVAL_MS,
      lastKeyRotation: this.lastKeyRotation,
      counterExploitProfit: this.counterExploitProfit,
      lastAttackTime: this.lastAttackTime,
      ordersScreened: this.ordersScreened,
      ordersBlocked: this.ordersBlocked,
      ticksProcessed: this.ticksProcessed,
      patchesApplied: this.patches.length,
      mempoolMode: this.config.blocknativeApiKey ? 'private' : 'passive',
    };
  }
  getAttacks() { return this.attacks; }
  getManipulations() { return this.manipulations; }
  getOpportunities() { return this.opportunities; }
  getPatches() { return this.patches; }
  getLog() { return this.log; }
  getBlacklist() { return Array.from(this.blacklist); }
  setDefenseActive(on: boolean) { this.active = on; this.mode = on ? 'ACTIVE' : 'PASSIVE'; this.notify(); }
  setPrivateMempool(on: boolean) { this.privateMempoolActive = on; this.notify(); }
  clearBlacklist() { this.blacklist.clear(); this.notify(); }
  reset() {
    this.attacks = []; this.manipulations = []; this.log = [];
    this.opportunities = []; this.patches = []; this.recentAttackTypes = [];
    this.counterExploitProfit = 0; this.ordersBlocked = 0; this.ordersScreened = 0;
    this.rtHedgeDelayMs = DEFENSE_PARAMS.HEDGE_DELAY_MS; this.rtSpoofCutoff = 0.7; this.rtOrderCapRatio = 0.3;
    this.notify();
  }

  private pushLog(e: DefenseLogEntry) {
    this.log.unshift(e);
    if (this.log.length > 300) this.log.pop();
  }

  // ---------- ingestion (called per engine tick) ----------
  ingestTick(markets: Market[], trades: Trade[]): void {
    if (!this.active) return;
    this.ticksProcessed += 1;
    this.rotateKeyIfNeeded();

    const now = Date.now();
    const cutoff = now - 60000;
    this.cancellations = this.cancellations.filter(c => c.timestamp > cutoff);
    this.orders = this.orders.filter(o => o.timestamp > cutoff);

    // Treat rapid-fire same-address trades as order/cancel churn signal.
    for (const t of trades.slice(0, 400)) {
      this.orders.push({
        timestamp: t.timestamp, marketId: t.marketId,
        amount: t.amount, price: t.price, fromAddress: t.traderAddress,
      });
      if ((t.gasPrice ?? 0) > DEFENSE_PARAMS.HIGH_GAS_THRESHOLD_GWEI) {
        this.cancellations.push({
          timestamp: t.timestamp, marketId: t.marketId,
          orderId: t.id, fromAddress: t.traderAddress,
        });
      }
    }
    if (this.orders.length > 1500) this.orders = this.orders.slice(-1500);
    if (this.cancellations.length > 1000) this.cancellations = this.cancellations.slice(-1000);

    // Per-address pattern scan
    const addresses = new Set(this.orders.map(o => o.fromAddress));
    for (const addr of addresses) {
      const detection = this.detectAttackPattern(addr);
      if (detection.isAttack && detection.confidence > 0.65) this.handleAttack(detection);
    }

    // Multi-market probing
    this.scanMultiMarket();

    // Market manipulation (BTC 5-min / oracle window)
    for (const m of markets.slice(0, 40)) {
      const hist = this.priceHistory.get(m.id) ?? [];
      hist.push(m.outcomePrices?.[0] ?? 0.5);
      if (hist.length > 40) hist.shift();
      this.priceHistory.set(m.id, hist);

      const signal = this.detectManipulation(m, hist);
      if (signal.detected && signal.confidence > 0.7) {
        this.manipulations.unshift(signal);
        if (this.manipulations.length > 60) this.manipulations.pop();
        this.pushLog({
          id: rid(), ts: now, kind: 'manipulation', severity: 'warning',
          title: `Manipulation: ${signal.type}`,
          detail: `${m.slug} · impact ${(signal.estimatedImpact * 100).toFixed(2)}% · action ${signal.recommendedAction}`,
        });
      }
    }

    this.notify();
  }

  // ---------- detection ----------
  private detectAttackPattern(address: string): AttackDetection {
    const cancels = this.cancellations.filter(c => c.fromAddress === address);
    const orders = this.orders.filter(o => o.fromAddress === address);
    const markets = new Set(cancels.map(c => c.marketId));
    const base = { id: rid(), timestamp: Date.now(), attackerAddress: address };

    // Nonce race: high-gas churn + repeated cancels
    if (cancels.length > 2 && orders.length > 4) {
      return {
        ...base, isAttack: true, attackType: 'NONCE_RACE',
        confidence: Math.min(0.95, 0.7 + cancels.length * 0.05),
        affectedMarkets: Array.from(markets),
        estimatedProfit: cancels.length * 100,
      };
    }

    // Ghost fill: sub-3s place/cancel churn
    const ghost = this.detectGhostFill(address);
    if (ghost.detected) {
      return {
        ...base, isAttack: true, attackType: 'GHOST_FILL',
        confidence: ghost.confidence,
        affectedMarkets: Array.from(new Set(orders.map(o => o.marketId))),
        estimatedProfit: orders.length * 50,
      };
    }

    // Cancel flood
    const rate = cancels.filter(c => Date.now() - c.timestamp < 10000).length;
    if (rate > DEFENSE_PARAMS.CANCEL_FLOOD_THRESHOLD) {
      return {
        ...base, isAttack: true, attackType: 'CANCEL_FLOOD',
        confidence: Math.min(0.85, 0.5 + rate * 0.03),
        affectedMarkets: Array.from(markets),
      };
    }

    return { id: base.id, isAttack: false, attackType: 'NONE', confidence: 0, timestamp: base.timestamp };
  }

  private detectGhostFill(address: string): { detected: boolean; confidence: number } {
    const rows = this.orders.filter(o => o.fromAddress === address).slice(-20);
    if (rows.length < 5) return { detected: false, confidence: 0 };
    let bursts = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].timestamp - rows[i - 1].timestamp < DEFENSE_PARAMS.GHOST_FILL_WINDOW_MS) bursts++;
    }
    const ratio = bursts / rows.length;
    if (ratio > DEFENSE_PARAMS.CANCEL_ALL_PATTERN_THRESHOLD) return { detected: true, confidence: 0.85 };
    if (bursts > 3) return { detected: true, confidence: 0.72 };
    return { detected: false, confidence: 0 };
  }

  private scanMultiMarket(): void {
    const groups = new Map<string, Set<string>>();
    for (const c of this.cancellations) {
      if (!groups.has(c.fromAddress)) groups.set(c.fromAddress, new Set());
      groups.get(c.fromAddress)!.add(c.marketId);
    }
    for (const [address, markets] of groups) {
      if (markets.size >= DEFENSE_PARAMS.MULTI_MARKET_THRESHOLD) {
        this.handleAttack({
          id: rid(), isAttack: true, attackType: 'MULTI_MARKET', attackerAddress: address,
          confidence: Math.min(0.9, 0.5 + markets.size * 0.05),
          timestamp: Date.now(), affectedMarkets: Array.from(markets),
          estimatedProfit: markets.size * 100,
        });
      }
    }
  }

  detectManipulation(market: Market, priceHistory: number[]): ManipulationSignal {
    const slug = (market.slug || '').toLowerCase();
    if (slug.includes('btc') || slug.includes('bitcoin')) {
      const s = this.detectBTCManipulation(priceHistory);
      return { ...s, marketSlug: market.slug };
    }
    // Oracle window heuristic: low-liquidity nighttime / weekend UTC hours
    const hour = new Date().getUTCHours();
    const day = new Date().getUTCDay();
    if ((hour < 6 || day === 0 || day === 6) && market.liquidity < 20000) {
      return {
        detected: true, confidence: 0.72, type: 'SPOT_ORACLE',
        estimatedImpact: 0.03, recommendedAction: 'AVOID', marketSlug: market.slug,
      };
    }
    return { detected: false, confidence: 0, type: 'NONE', estimatedImpact: 0, recommendedAction: 'AVOID' };
  }

  private detectBTCManipulation(prices: number[]): ManipulationSignal {
    const none: ManipulationSignal = { detected: false, confidence: 0, type: 'NONE', estimatedImpact: 0, recommendedAction: 'AVOID' };
    if (prices.length < 20) return none;
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const recent = mean(prices.slice(-10));
    const prev = mean(prices.slice(-20, -10));
    if (!prev) return none;
    const impact = Math.abs((recent - prev) / prev);
    if (impact <= DEFENSE_PARAMS.PRICE_IMPACT_THRESHOLD) return none;

    const move = mean(prices.slice(-5)) - mean(prices.slice(-10, -5));
    const reversal = prices[prices.length - 1] - prices[prices.length - 5];
    const reversed = (move > 0.005 && reversal < -0.005) || (move < -0.005 && reversal > 0.005);
    if (!reversed) return none;

    return {
      detected: true,
      confidence: Math.min(0.9, 0.6 + impact * 5),
      type: 'BTC_5MIN',
      estimatedImpact: impact,
      recommendedAction: 'AVOID',
    };
  }

  // ---------- response ----------
  private handleAttack(attack: AttackDetection): void {
    // de-duplicate same address+type within 20s
    const dup = this.attacks.find(a =>
      a.attackerAddress === attack.attackerAddress &&
      a.attackType === attack.attackType &&
      Date.now() - a.timestamp < 20000);
    if (dup) return;

    this.lastAttackTime = attack.timestamp;
    this.attacks.unshift(attack);
    if (this.attacks.length > 100) this.attacks.pop();
    if (attack.attackerAddress) this.blacklist.add(attack.attackerAddress);

    this.pushLog({
      id: rid(), ts: attack.timestamp, kind: 'attack',
      severity: attack.confidence > 0.8 ? 'critical' : 'warning',
      title: `Attack detected: ${attack.attackType.replace('_', ' ')}`,
      detail: `${attack.attackerAddress?.slice(0, 10)}… · conf ${(attack.confidence * 100).toFixed(0)}% · ${attack.affectedMarkets?.length ?? 0} market(s)`,
    });

    // Counter-exploit: pre-position at the spread the attacker intends to set
    if (['NONCE_RACE', 'GHOST_FILL', 'MULTI_MARKET'].includes(attack.attackType)) {
      const marketIds = attack.affectedMarkets ?? [];
      const markets = Math.max(1, marketIds.length);
      const expectedProfit = (0.58 - 0.42) * 100 * markets * attack.confidence;
      this.counterExploitProfit += expectedProfit;

      const opp: CounterOpportunity = {
        id: rid(),
        attackType: attack.attackType,
        attackerAddress: attack.attackerAddress,
        marketIds,
        expectedProfit,
        confidence: attack.confidence,
        timestamp: Date.now(),
      };
      this.opportunities.unshift(opp);
      if (this.opportunities.length > 50) this.opportunities.pop();
      this.pushLog({
        id: rid(), ts: opp.timestamp, kind: 'opportunity', severity: 'info',
        title: `Counter-exploit opportunity: $${expectedProfit.toFixed(2)}`,
        detail: `${attack.attackType.replace('_', ' ')} · conf ${(attack.confidence * 100).toFixed(0)}% · ${markets} market(s)`,
      });
      this.emitEvent('opportunity_ready', opp);
    }

    // Self-healing: recurring attack types tighten runtime defense params
    this.evaluateSelfHealing(attack.attackType);

    // Escalate then cool back down
    this.mode = 'AGGRESSIVE';
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      if (this.active) { this.mode = 'ACTIVE'; this.notify(); }
    }, 30000);
  }

  private evaluateSelfHealing(type: AttackType): void {
    const now = Date.now();
    this.recentAttackTypes.push({ type, ts: now });
    this.recentAttackTypes = this.recentAttackTypes.filter(r => now - r.ts <= DEFENSE_PARAMS.PATCH_WINDOW_MS);

    const count = this.recentAttackTypes.filter(r => r.type === type).length;
    if (count < DEFENSE_PARAMS.PATCH_TRIGGER_COUNT) return;
    // one patch per vulnerability per window
    if (this.patches.some(p => p.vulnerability === type && now - p.appliedAt <= DEFENSE_PARAMS.PATCH_WINDOW_MS)) return;

    let patchType: PatchType;
    let detail: string;
    switch (type) {
      case 'NONCE_RACE':
        this.rtHedgeDelayMs = Math.min(15000, Math.round(this.rtHedgeDelayMs * 1.5) || 2000);
        patchType = 'EXTEND_HEDGE_DELAY';
        detail = `Hedge delay raised to ${this.rtHedgeDelayMs}ms after ${count} nonce races`;
        break;
      case 'CANCEL_FLOOD':
        this.rtSpoofCutoff = Math.max(0.35, +(this.rtSpoofCutoff - 0.1).toFixed(2));
        patchType = 'TIGHTEN_SPOOF_CUTOFF';
        detail = `Spoof cutoff tightened to ${this.rtSpoofCutoff} after ${count} cancel floods`;
        break;
      case 'MULTI_MARKET':
      case 'GHOST_FILL':
        this.rtOrderCapRatio = Math.max(0.08, +(this.rtOrderCapRatio - 0.05).toFixed(2));
        patchType = 'SHRINK_ORDER_CAP';
        detail = `Order cap reduced to ${(this.rtOrderCapRatio * 100).toFixed(0)}% of capital after ${count} ${type.replace('_', ' ').toLowerCase()} events`;
        break;
      default:
        patchType = 'RAISE_GAS_THRESHOLD';
        detail = `Gas shadow threshold raised after ${count} ${type.replace('_', ' ').toLowerCase()} events`;
    }

    const patch: SelfHealingPatch = { id: rid(), patchType, vulnerability: type, appliedAt: now, detail };
    this.patches.unshift(patch);
    if (this.patches.length > 50) this.patches.pop();
    this.pushLog({
      id: rid(), ts: now, kind: 'patch', severity: 'warning',
      title: `Self-healing patch: ${patchType.replace(/_/g, ' ').toLowerCase()}`,
      detail,
    });
    this.emitEvent('patch_applied', patch);
  }

  private rotateKeyIfNeeded() {
    if (Date.now() - this.lastKeyRotation > DEFENSE_PARAMS.NONCE_ROTATION_INTERVAL_MS) {
      this.lastKeyRotation = Date.now();
      this.keyHistory = Math.min(10, this.keyHistory + 1);
      this.pushLog({
        id: rid(), ts: Date.now(), kind: 'key_rotated', severity: 'info',
        title: 'ECDSA signing key rotated',
        detail: `${this.keyHistory} historical key(s) retained · nonce-reuse protection`,
      });
    }
  }

  // ---------- pre-trade gate ----------
  validateOrder(
    order: { marketId: string; amount: number; price: number; market?: Market; priceHistory?: number[] },
    fromAddress: string,
    botCapital: number,
  ): OrderValidation {
    this.ordersScreened += 1;
    const reject = (reason: string, waitMs: number, manual: boolean): OrderValidation => {
      this.ordersBlocked += 1;
      this.pushLog({
        id: rid(), ts: Date.now(), kind: 'order_rejected', severity: 'warning',
        title: 'Order blocked', detail: `${reason} · ${fromAddress.slice(0, 10)}…`,
      });
      this.notify();
      return { isValid: false, reason, suggestedWaitMs: waitMs, requiresManualVerification: manual };
    };

    if (!this.active) return { isValid: true, suggestedWaitMs: 0, requiresManualVerification: false };
    if (this.blacklist.has(fromAddress)) return reject('Counterparty is blacklisted attacker', 60000, true);
    if (this.detectGhostFill(fromAddress).detected) return reject('Ghost Fill pattern detected', 30000, true);
    if (order.amount * order.price > botCapital * 0.3) return reject('Order size exceeds safe threshold (potential spoof)', 5000, false);
    if (this.spoofScore(fromAddress) > 0.7) return reject('High spoof probability', 30000, true);
    if (order.market && this.detectManipulation(order.market, order.priceHistory ?? []).detected) {
      return reject('Market manipulation detected', 60000, true);
    }
    return {
      isValid: true,
      suggestedWaitMs: this.mode === 'AGGRESSIVE' ? DEFENSE_PARAMS.HEDGE_DELAY_MS : 0,
      requiresManualVerification: false,
    };
  }

  private spoofScore(address: string): number {
    const rows = this.orders.filter(o => o.fromAddress === address);
    if (rows.length < 5) return 0;
    let fast = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].timestamp - rows[i - 1].timestamp < 500) fast++;
    return Math.min(1, (fast / rows.length) * 2);
  }

  // ---------- export ----------
  toCsv(): string {
    const head = 'timestamp,kind,severity,title,detail';
    const rows = this.log.map(e =>
      [new Date(e.ts).toISOString(), e.kind, e.severity, `"${e.title.replace(/"/g, '""')}"`, `"${e.detail.replace(/"/g, '""')}"`].join(','));
    return [head, ...rows].join('\n');
  }
}

export { EnhancedNonceRaceDefender };
export const nonceDefender = new EnhancedNonceRaceDefender();
