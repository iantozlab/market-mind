// MultiMarketArbitrage.ts
// Mutually exclusive, dependent and combinatorial arbitrage scanning.
// Browser-safe: uses a minimal internal emitter instead of node's `events`.

export interface ArbMarket {
  id: string;
  conditionId: string;
  outcome: string;
  price: number;
  negRisk: boolean;
  parentConditionId?: string;
  slug?: string;
}

export type ArbType = 'mutually_exclusive' | 'dependent' | 'combinatorial';

export interface ArbLeg {
  marketId: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
}

export interface ArbitrageSignal {
  id: string;
  ts: number;
  type: ArbType;
  legs: ArbLeg[];
  guaranteedProfit: number;
  confidence: number;
  requiredCapital: number;
  label: string;
}

type Listener<T> = (payload: T) => void;

class TinyEmitter<E extends Record<string, unknown>> {
  private listeners: { [K in keyof E]?: Listener<E[K]>[] } = {};
  on<K extends keyof E>(evt: K, fn: Listener<E[K]>) {
    (this.listeners[evt] ||= []).push(fn);
    return this;
  }
  emit<K extends keyof E>(evt: K, payload: E[K]) {
    for (const fn of this.listeners[evt] ?? []) {
      try { fn(payload); } catch { /* listener errors must not break the loop */ }
    }
  }
}

const FEE = 0.02; // per-leg round-trip fee assumption

export class MultiMarketArbitrageEngine extends TinyEmitter<{
  arbitrageExecuted: ArbitrageSignal;
}> {
  private markets: ArbMarket[] = [];
  private conditionMap = new Map<string, ArbMarket[]>();
  private executed: ArbitrageSignal[] = [];
  private realizedProfit = 0;
  private seq = 0;

  updateMarkets(markets: ArbMarket[]): void {
    this.markets = markets;
    this.conditionMap.clear();
    for (const m of markets) {
      const key = m.conditionId || m.parentConditionId || 'root';
      if (!this.conditionMap.has(key)) this.conditionMap.set(key, []);
      this.conditionMap.get(key)!.push(m);
    }
  }

  scanAll(): ArbitrageSignal[] {
    const signals = [
      ...this.scanMutuallyExclusive(),
      ...this.scanDependentMarkets(),
      ...this.scanCombinatorial(),
    ];
    return signals.sort((a, b) => b.guaranteedProfit - a.guaranteedProfit);
  }

  private make(type: ArbType, legs: ArbLeg[], profit: number, confidence: number, capital: number, label: string): ArbitrageSignal {
    return { id: `arb-${type}-${++this.seq}`, ts: Date.now(), type, legs, guaranteedProfit: profit, confidence, requiredCapital: capital, label };
  }

  private scanMutuallyExclusive(): ArbitrageSignal[] {
    const out: ArbitrageSignal[] = [];
    for (const [cond, group] of this.conditionMap) {
      if (group.length < 2) continue;
      const total = group.reduce((s, m) => s + m.price, 0);
      if (total <= 1.02) continue;
      const profit = total - 1 - FEE * group.length;
      if (profit <= 0) continue;
      out.push(this.make(
        'mutually_exclusive',
        group.map(m => ({ marketId: m.id, side: 'SELL' as const, price: m.price, amount: 1 })),
        profit, 0.95, total,
        `${group[0].slug ?? cond} · Σp ${total.toFixed(3)}`,
      ));
    }
    return out;
  }

  private scanDependentMarkets(): ArbitrageSignal[] {
    const out: ArbitrageSignal[] = [];
    for (const m of this.markets) {
      if (!m.parentConditionId) continue;
      const parent = this.markets.find(p => p.conditionId === m.parentConditionId);
      if (!parent || parent.id === m.id) continue;
      if (m.price <= parent.price + 0.02) continue;
      const profit = m.price - parent.price - 2 * FEE;
      if (profit <= 0) continue;
      out.push(this.make(
        'dependent',
        [
          { marketId: parent.id, side: 'BUY', price: parent.price, amount: 1 },
          { marketId: m.id, side: 'SELL', price: m.price, amount: 1 },
        ],
        profit, 0.9, m.price,
        `${m.slug ?? m.id} ⊂ ${parent.slug ?? parent.id}`,
      ));
    }
    return out;
  }

  private scanCombinatorial(): ArbitrageSignal[] {
    const out: ArbitrageSignal[] = [];
    for (const [cond, group] of this.conditionMap) {
      if (group.length < 2) continue;
      const total = group.reduce((s, m) => s + m.price, 0);
      const gap = Math.abs(total - 1);
      if (gap <= 0.03) continue;
      const profit = gap - FEE * group.length;
      if (profit <= 0) continue;
      out.push(this.make(
        'combinatorial',
        group.map(m => ({ marketId: m.id, side: (total > 1 ? 'SELL' : 'BUY') as 'BUY' | 'SELL', price: m.price, amount: 1 })),
        profit, 0.85, total > 1 ? total : 1,
        `${group[0].slug ?? cond} · gap ${(gap * 100).toFixed(1)}%`,
      ));
    }
    return out;
  }

  async executeArbitrage(signal: ArbitrageSignal, capital: number): Promise<boolean> {
    if (capital < signal.requiredCapital) return false;
    this.realizedProfit += signal.guaranteedProfit;
    this.executed = [signal, ...this.executed].slice(0, 200);
    this.emit('arbitrageExecuted', signal);
    return true;
  }

  getExecuted(): ArbitrageSignal[] { return [...this.executed]; }
  getRealizedProfit(): number { return this.realizedProfit; }
  reset(): void { this.executed = []; this.realizedProfit = 0; }
}
