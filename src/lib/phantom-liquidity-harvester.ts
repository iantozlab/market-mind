// ============================================
// PHANTOM LIQUIDITY HARVESTER — Proprietary Strategy
// Exploits low-liquidity, high-spread markets via tier-adaptive ghost making
// ============================================

import type { Market } from './neural-bot-engine';

export const PHANTOM_PARAMS = {
  TIER_1_MAX: 500,
  TIER_2_MAX: 2500,
  TIER_3_MAX: 10000,

  SPREAD_TIER_1: 0.08,
  SPREAD_TIER_2: 0.10,
  SPREAD_TIER_3: 0.12,
  SPREAD_TIER_4: 0.15,

  MAX_CAPITAL_AT_RISK_PCT: 0.30,
  MIN_ORDER_SIZE: 10,
  MAX_ORDER_SIZE: 5000,

  DMI_SCOUT_THRESHOLD: 85,
  DMI_LITE_THRESHOLD: 75,
  DMI_FULL_THRESHOLD: 65,
  DMI_ALPHA_THRESHOLD: 55,

  MIN_LIQUIDITY: 50000,
  MIN_VOLUME_24H: 1000,
  MIN_SPREAD: 0.05,
  MIN_HOURS_TO_EXPIRY: 4,

  MAX_HOLD_HOURS: 24,
};

export interface TierConfig {
  tier: number;
  name: string;
  spreadTarget: number;
  maxMarkets: number;
  dmiThreshold: number;
  positionSizePct: number;
  dailyTarget: number;
}

export const TIERS: Record<number, TierConfig> = {
  1: { tier: 1, name: 'Scout',          spreadTarget: PHANTOM_PARAMS.SPREAD_TIER_1, maxMarkets: 2,  dmiThreshold: PHANTOM_PARAMS.DMI_SCOUT_THRESHOLD, positionSizePct: 0.10, dailyTarget: 10 },
  2: { tier: 2, name: 'Harvester Lite', spreadTarget: PHANTOM_PARAMS.SPREAD_TIER_2, maxMarkets: 4,  dmiThreshold: PHANTOM_PARAMS.DMI_LITE_THRESHOLD,  positionSizePct: 0.20, dailyTarget: 30 },
  3: { tier: 3, name: 'Full Harvester', spreadTarget: PHANTOM_PARAMS.SPREAD_TIER_3, maxMarkets: 8,  dmiThreshold: PHANTOM_PARAMS.DMI_FULL_THRESHOLD,  positionSizePct: 0.25, dailyTarget: 100 },
  4: { tier: 4, name: 'Alpha Harvester',spreadTarget: PHANTOM_PARAMS.SPREAD_TIER_4, maxMarkets: 15, dmiThreshold: PHANTOM_PARAMS.DMI_ALPHA_THRESHOLD, positionSizePct: 0.30, dailyTarget: 300 },
};

export interface PhantomMarket {
  id: string; slug: string; question: string;
  liquidity: number; volume24h: number; spread: number;
  hoursToExpiry: number; dmiScore: number; expectedDailyReturn: number;
}

export interface HarvestState {
  marketId: string; slug: string;
  bidPrice: number; askPrice: number;
  bidSize: number; askSize: number;
  entryTime: number; spreadTarget: number;
  status: 'active' | 'filled_bid' | 'filled_ask' | 'both_filled';
  profitRealized: number;
}

export function determineTier(capital: number): number {
  if (capital < PHANTOM_PARAMS.TIER_1_MAX) return 1;
  if (capital < PHANTOM_PARAMS.TIER_2_MAX) return 2;
  if (capital < PHANTOM_PARAMS.TIER_3_MAX) return 3;
  return 4;
}

function getSpread(m: Market): number {
  return Math.abs((m.outcomePrices[1] ?? 0.5) - (m.outcomePrices[0] ?? 0.5));
}
function hoursRemaining(m: Market): number {
  return Math.max(0, (new Date(m.endDate).getTime() - Date.now()) / 3_600_000);
}

export function computeDMI(m: Market): { dmiScore: number; expectedDailyReturn: number } {
  const liq = Math.max(0, 1 - m.liquidity / PHANTOM_PARAMS.MIN_LIQUIDITY);
  const vol = Math.max(0, 1 - m.volume / PHANTOM_PARAMS.MIN_VOLUME_24H);
  const sprd = Math.min(1, getSpread(m) / 0.15);
  const time = Math.min(1, hoursRemaining(m) / 72);
  const dmiScore = Math.min(100, Math.max(0, (liq * 0.35 + vol * 0.25 + sprd * 0.20 + time * 0.20) * 100));
  const expectedDailyReturn =
    dmiScore >= 90 ? 120 : dmiScore >= 80 ? 80 : dmiScore >= 70 ? 50 : dmiScore >= 60 ? 30 : 15;
  return { dmiScore, expectedDailyReturn };
}

export class PhantomLiquidityHarvester {
  private active = new Map<string, HarvestState>();
  capital: number;
  tier: number;
  totalProfit = 0;
  fills = 0;
  wins = 0;

  constructor(initialCapital: number) {
    this.capital = initialCapital;
    this.tier = determineTier(initialCapital);
  }

  scan(markets: Market[]): PhantomMarket[] {
    const cfg = TIERS[this.tier];
    const out: PhantomMarket[] = [];
    for (const m of markets) {
      const spread = getSpread(m);
      const hrs = hoursRemaining(m);
      if (m.liquidity >= PHANTOM_PARAMS.MIN_LIQUIDITY) continue;
      if (m.volume >= PHANTOM_PARAMS.MIN_VOLUME_24H) continue;
      if (spread <= PHANTOM_PARAMS.MIN_SPREAD) continue;
      if (hrs <= PHANTOM_PARAMS.MIN_HOURS_TO_EXPIRY) continue;
      const { dmiScore, expectedDailyReturn } = computeDMI(m);
      if (dmiScore < cfg.dmiThreshold) continue;
      out.push({
        id: m.id, slug: m.slug, question: m.question,
        liquidity: m.liquidity, volume24h: m.volume, spread,
        hoursToExpiry: hrs, dmiScore, expectedDailyReturn,
      });
    }
    return out.sort((a, b) => b.dmiScore - a.dmiScore);
  }

  deploy(market: PhantomMarket, midPrice: number): HarvestState | null {
    if (this.active.has(market.id)) return null;
    const cfg = TIERS[this.tier];
    if (this.active.size >= cfg.maxMarkets) return null;
    const maxRisk = this.capital * PHANTOM_PARAMS.MAX_CAPITAL_AT_RISK_PCT;
    const desired = this.capital * cfg.positionSizePct * (market.dmiScore / 100);
    const sizePerSide = Math.min(desired / 2, maxRisk / 2, PHANTOM_PARAMS.MAX_ORDER_SIZE);
    if (sizePerSide < PHANTOM_PARAMS.MIN_ORDER_SIZE) return null;
    const half = cfg.spreadTarget / 2;
    const state: HarvestState = {
      marketId: market.id, slug: market.slug,
      bidPrice: Math.max(0.01, midPrice - half),
      askPrice: Math.min(0.99, midPrice + half),
      bidSize: sizePerSide, askSize: sizePerSide,
      entryTime: Date.now(), spreadTarget: cfg.spreadTarget,
      status: 'active', profitRealized: 0,
    };
    this.active.set(market.id, state);
    return state;
  }

  // Simulated fill monitor (paper-mode); returns realized profit this tick.
  tick(): { profit: number; events: HarvestState[] } {
    let profit = 0;
    const events: HarvestState[] = [];
    for (const [id, h] of this.active) {
      const heldH = (Date.now() - h.entryTime) / 3_600_000;
      if (heldH > PHANTOM_PARAMS.MAX_HOLD_HOURS) {
        this.active.delete(id);
        continue;
      }
      if (Math.random() < 0.10 && h.status === 'active') {
        const isBid = Math.random() > 0.5;
        const fillProfit = (isBid ? h.bidSize : h.askSize) * h.spreadTarget * 0.8;
        h.profitRealized += fillProfit;
        h.status = isBid ? 'filled_bid' : 'filled_ask';
        profit += fillProfit;
        this.fills++;
        if (fillProfit > 0) this.wins++;
        events.push({ ...h });
        this.active.delete(id);
      }
    }
    this.totalProfit += profit;
    this.capital += profit;
    const newTier = determineTier(this.capital);
    if (newTier !== this.tier) this.tier = newTier;
    return { profit, events };
  }

  getActive(): HarvestState[] { return Array.from(this.active.values()); }
  getStats() {
    const cfg = TIERS[this.tier];
    return {
      capital: this.capital,
      tier: this.tier,
      tierName: cfg.name,
      dailyTarget: cfg.dailyTarget,
      activeHarvests: this.active.size,
      deployedCapital: this.getActive().reduce((s, h) => s + h.bidSize + h.askSize, 0),
      totalProfit: this.totalProfit,
      winRate: this.fills > 0 ? this.wins / this.fills : 0,
    };
  }
}
