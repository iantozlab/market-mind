// Configurable risk limits + alert thresholds for arbitrage / swarm execution.
// Persisted to localStorage so the dashboard and engine stay in sync across reloads.

export interface ArbRiskLimits {
  /** Master switch — when false the engine scans but never executes. */
  executionEnabled: boolean;
  /** Paper trading mode: simulated fills only, everything written to the audit log. */
  paperMode: boolean;
  /** Max capital committed to a single arbitrage structure. */
  maxCapitalPerArb: number;
  /** Max total capital deployed across arbitrage in one tick. */
  maxCapitalPerTick: number;
  /** Minimum guaranteed profit (USD) required to execute. */
  minProfit: number;
  /** Minimum signal confidence (0-1). */
  minConfidence: number;
  /** Maximum number of legs in an executable structure. */
  maxLegs: number;
  /** Maximum executions allowed per tick. */
  maxExecutionsPerTick: number;
  /** Stop executing arbitrage once session arb P&L falls below -this. */
  maxDailyArbLoss: number;
  /** Minimum swarm edge (|swarm p - market p|) to fire a latency trade. */
  minSwarmEdge: number;
  /** Alert when top swarm divergence exceeds this. */
  divergenceAlertThreshold: number;
  /** Alert when HTM anomaly score exceeds this. */
  anomalyAlertThreshold: number;
}

export const DEFAULT_ARB_LIMITS: ArbRiskLimits = {
  executionEnabled: true,
  paperMode: true,
  maxCapitalPerArb: 500,
  maxCapitalPerTick: 2000,
  minProfit: 0.05,
  minConfidence: 0.8,
  maxLegs: 6,
  maxExecutionsPerTick: 3,
  maxDailyArbLoss: 250,
  minSwarmEdge: 0.02,
  divergenceAlertThreshold: 0.12,
  anomalyAlertThreshold: 0.75,
};

const KEY = 'arb-risk-limits-v1';

function load(): ArbRiskLimits {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_ARB_LIMITS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_ARB_LIMITS };
}

let limits: ArbRiskLimits = load();
const subs = new Set<(l: ArbRiskLimits) => void>();

export function getArbLimits(): ArbRiskLimits { return { ...limits }; }

export function setArbLimits(patch: Partial<ArbRiskLimits>): ArbRiskLimits {
  limits = { ...limits, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(limits)); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn({ ...limits }); } catch { /* ignore */ } });
  return { ...limits };
}

export function resetArbLimits(): ArbRiskLimits {
  return setArbLimits(DEFAULT_ARB_LIMITS);
}

export function subscribeArbLimits(fn: (l: ArbRiskLimits) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export interface LimitCheckInput {
  profit: number;
  confidence: number;
  legs: number;
  capital: number;
  capitalUsedThisTick: number;
  executionsThisTick: number;
  sessionArbPnL: number;
}

/** Returns null when the trade passes every limit, otherwise the blocking reason. */
export function checkArbLimits(i: LimitCheckInput): string | null {
  const l = limits;
  if (!l.executionEnabled) return 'execution disabled';
  if (i.sessionArbPnL <= -l.maxDailyArbLoss) return `daily arb loss limit ($${l.maxDailyArbLoss})`;
  if (i.profit < l.minProfit) return `profit < $${l.minProfit}`;
  if (i.confidence < l.minConfidence) return `confidence < ${(l.minConfidence * 100).toFixed(0)}%`;
  if (i.legs > l.maxLegs) return `legs > ${l.maxLegs}`;
  if (i.capital > l.maxCapitalPerArb) return `capital > $${l.maxCapitalPerArb} per arb`;
  if (i.capitalUsedThisTick + i.capital > l.maxCapitalPerTick) return `tick capital cap $${l.maxCapitalPerTick}`;
  if (i.executionsThisTick >= l.maxExecutionsPerTick) return `max ${l.maxExecutionsPerTick} executions/tick`;
  return null;
}
