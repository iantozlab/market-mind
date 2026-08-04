// Backtest runner for the multi_market_arb and polyswarm strategies.
// Replays synthetic (seeded) market snapshots through the real engines so the
// configured risk limits are evaluated exactly as they are live.
import { MultiMarketArbitrageEngine, type ArbMarket, type ArbitrageSignal } from './multi-market-arbitrage';
import { PolySwarmIntegrator, buildDefaultSwarm, type MarketDescription } from './polyswarm-integrator';
import { getArbLimits, type ArbRiskLimits, type LimitCheckInput } from './arb-risk-config';

/** Same rules as checkArbLimits, but evaluated against a run-scoped limit set. */
function localLimitCheck(l: ArbRiskLimits, i: LimitCheckInput): string | null {
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

export interface ArbBacktestConfig {
  ticks: number;
  marketsPerTick: number;
  seed: number;
  strategies: { multiMarketArb: boolean; polyswarm: boolean };
  /** Scenario window (epoch ms). Ticks are stamped across this range. */
  startTime: number;
  endTime: number;
  /** Simulated interval between ticks (ms). Derives tick count when the window is set. */
  tickIntervalMs: number;
  /** Round-trip taker fee in basis points, charged on deployed capital. */
  feeBps: number;
  /** Slippage in basis points, charged on deployed capital. */
  slippageBps: number;
  /** Optional overrides for the saved risk limits, applied for this run only. */
  riskOverrides: Partial<ArbRiskLimits>;
}

export interface ArbStrategyResult {
  strategy: 'multi_market_arb' | 'polyswarm';
  signals: number;
  executions: number;
  blocked: number;
  grossProfit: number;
  netProfit: number;
  hitRate: number;
  sharpe: number;
  maxDrawdown: number;
  avgProfit: number;
  equity: number[];
}

export interface ArbBacktestResult {
  ranAt: number;
  config: ArbBacktestConfig;
  limits: ArbRiskLimits;
  results: ArbStrategyResult[];
  combinedNet: number;
  blockedReasons: Record<string, number>;
}

const NOW = Date.now();

export const DEFAULT_ARB_BACKTEST: ArbBacktestConfig = {
  ticks: 250,
  marketsPerTick: 14,
  seed: 42,
  strategies: { multiMarketArb: true, polyswarm: true },
  startTime: NOW - 24 * 3600e3,
  endTime: NOW,
  tickIntervalMs: 5 * 60e3,
  feeBps: 20,
  slippageBps: 15,
  riskOverrides: {},
};

/** Ticks implied by the scenario window, clamped so a run stays responsive. */
export function ticksFromWindow(c: ArbBacktestConfig): number {
  const span = Math.max(0, c.endTime - c.startTime);
  if (!span || !c.tickIntervalMs) return c.ticks;
  return Math.max(10, Math.min(5000, Math.round(span / c.tickIntervalMs)));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stats(pnl: number[]): { sharpe: number; maxDrawdown: number; equity: number[] } {
  const equity: number[] = [];
  let cum = 0, peak = 0, dd = 0;
  for (const p of pnl) {
    cum += p;
    equity.push(cum);
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  const mean = pnl.length ? pnl.reduce((s, x) => s + x, 0) / pnl.length : 0;
  const variance = pnl.length ? pnl.reduce((s, x) => s + (x - mean) ** 2, 0) / pnl.length : 0;
  const sd = Math.sqrt(variance);
  return { sharpe: sd > 0 ? (mean / sd) * Math.sqrt(pnl.length || 1) : 0, maxDrawdown: dd, equity };
}

export async function runArbBacktest(
  config: ArbBacktestConfig = DEFAULT_ARB_BACKTEST,
  onProgress?: (pct: number) => void,
): Promise<ArbBacktestResult> {
  const limits: ArbRiskLimits = { ...getArbLimits(), ...(config.riskOverrides ?? {}) };
  const totalTicks = ticksFromWindow(config);
  const costRate = ((config.feeBps ?? 0) + (config.slippageBps ?? 0)) / 10_000;
  const rand = mulberry32(config.seed);
  const arbEngine = new MultiMarketArbitrageEngine();
  const swarm = new PolySwarmIntegrator();
  buildDefaultSwarm(swarm, 50);

  const arbPnl: number[] = [];
  const swarmPnl: number[] = [];
  const blockedReasons: Record<string, number> = {};
  let arbSignals = 0, arbExec = 0, arbBlocked = 0, arbGross = 0, arbWins = 0;
  let swarmSignals = 0, swarmExec = 0, swarmBlocked = 0, swarmGross = 0, swarmWins = 0;

  for (let tick = 0; tick < totalTicks; tick++) {
    // --- synthetic market snapshot -------------------------------------
    const arbMarkets: ArbMarket[] = [];
    const descriptions: MarketDescription[] = [];
    for (let m = 0; m < config.marketsPerTick; m++) {
      const id = `bt-${tick}-${m}`;
      const base = 0.15 + rand() * 0.7;
      const skew = (rand() - 0.5) * 0.12;          // creates Σp ≠ 1 structures
      const legs = rand() > 0.75 ? 3 : 2;
      const prices: number[] = [];
      for (let i = 0; i < legs; i++) {
        prices.push(Math.min(0.98, Math.max(0.02, i === 0 ? base : (1 - base) / (legs - 1) + skew)));
      }
      prices.forEach((p, i) => arbMarkets.push({
        id: `${id}:${i}`, conditionId: id, outcome: `O${i}`, price: p,
        negRisk: legs > 2, parentConditionId: `cat:${m % 4}`, slug: `market-${m}`,
      }));
      descriptions.push({
        id, question: `Synthetic market ${m}`, outcomes: prices.map((_, i) => `O${i}`),
        currentPrice: prices[0], category: `cat:${m % 4}`, slug: `market-${m}`,
        timeToExpiry: 1000 * 60 * 60 * 24 * (1 + rand() * 30),
      });
    }

    let tickArb = 0, tickSwarm = 0;

    // --- multi-market arbitrage ----------------------------------------
    if (config.strategies.multiMarketArb) {
      arbEngine.updateMarkets(arbMarkets);
      const signals: ArbitrageSignal[] = arbEngine.scanAll();
      arbSignals += signals.length;
      let capitalUsed = 0, execs = 0;
      for (const s of signals) {
        const reason = localLimitCheck(limits, {
          profit: s.guaranteedProfit, confidence: s.confidence, legs: s.legs.length,
          capital: s.requiredCapital, capitalUsedThisTick: capitalUsed,
          executionsThisTick: execs, sessionArbPnL: arbGross,
        });
        if (reason) {
          arbBlocked++;
          blockedReasons[reason] = (blockedReasons[reason] ?? 0) + 1;
          continue;
        }
        // Slippage / partial-fill haircut keeps results honest.
        const realized = s.guaranteedProfit * (0.6 + rand() * 0.5) - s.requiredCapital * costRate;
        capitalUsed += s.requiredCapital;
        execs++; arbExec++;
        arbGross += realized;
        tickArb += realized;
        if (realized > 0) arbWins++;
      }
    }

    // --- polyswarm -------------------------------------------------------
    if (config.strategies.polyswarm) {
      const ineff = await swarm.detectInefficiencies(descriptions.slice(0, 8), 0.05);
      swarmSignals += ineff.length;
      for (const p of ineff.slice(0, limits.maxExecutionsPerTick)) {
        const edge = Math.abs(p.swarmProbability - (descriptions.find(d => d.id === p.marketId)?.currentPrice ?? 0));
        if (edge < limits.minSwarmEdge || p.swarmConfidence < limits.minConfidence) {
          swarmBlocked++;
          const r = edge < limits.minSwarmEdge ? `swarm edge < ${limits.minSwarmEdge}` : 'swarm confidence below min';
          blockedReasons[r] = (blockedReasons[r] ?? 0) + 1;
          continue;
        }
        const size = Math.min(limits.maxCapitalPerArb, 100 + rand() * 400);
        const won = rand() < 0.5 + Math.min(0.25, edge * 2);
        const realized = (won ? size * edge * 0.9 : -size * edge * 0.7) - size * costRate;
        swarmExec++; swarmGross += realized; tickSwarm += realized;
        if (won) swarmWins++;
      }
    }

    arbPnl.push(tickArb);
    swarmPnl.push(tickSwarm);
    if (onProgress && tick % 10 === 0) onProgress(Math.round((tick / totalTicks) * 100));
    if (tick % 25 === 0) await new Promise(r => setTimeout(r, 0)); // keep the UI responsive
  }

  const results: ArbStrategyResult[] = [];
  if (config.strategies.multiMarketArb) {
    const s = stats(arbPnl);
    results.push({
      strategy: 'multi_market_arb', signals: arbSignals, executions: arbExec, blocked: arbBlocked,
      grossProfit: arbGross, netProfit: arbGross, hitRate: arbExec ? arbWins / arbExec : 0,
      sharpe: s.sharpe, maxDrawdown: s.maxDrawdown, avgProfit: arbExec ? arbGross / arbExec : 0, equity: s.equity,
    });
  }
  if (config.strategies.polyswarm) {
    const s = stats(swarmPnl);
    results.push({
      strategy: 'polyswarm', signals: swarmSignals, executions: swarmExec, blocked: swarmBlocked,
      grossProfit: swarmGross, netProfit: swarmGross, hitRate: swarmExec ? swarmWins / swarmExec : 0,
      sharpe: s.sharpe, maxDrawdown: s.maxDrawdown, avgProfit: swarmExec ? swarmGross / swarmExec : 0, equity: s.equity,
    });
  }
  onProgress?.(100);

  return {
    ranAt: Date.now(),
    config,
    limits,
    results,
    combinedNet: results.reduce((s, r) => s + r.netProfit, 0),
    blockedReasons,
  };
}

export function arbBacktestToCsv(r: ArbBacktestResult): string {
  const head = ['strategy', 'signals', 'executions', 'blocked', 'net_profit', 'hit_rate', 'sharpe', 'max_drawdown', 'avg_profit'];
  const rows = r.results.map(x => [
    x.strategy, x.signals, x.executions, x.blocked, x.netProfit.toFixed(2),
    (x.hitRate * 100).toFixed(1), x.sharpe.toFixed(2), x.maxDrawdown.toFixed(2), x.avgProfit.toFixed(3),
  ].join(','));
  const meta = [
    '',
    `# ran_at,${new Date(r.ranAt).toISOString()}`,
    `# ticks,${r.config.ticks}`,
    `# markets_per_tick,${r.config.marketsPerTick}`,
    `# seed,${r.config.seed}`,
    `# start_time,${new Date(r.config.startTime).toISOString()}`,
    `# end_time,${new Date(r.config.endTime).toISOString()}`,
    `# tick_interval_ms,${r.config.tickIntervalMs}`,
    `# fee_bps,${r.config.feeBps}`,
    `# slippage_bps,${r.config.slippageBps}`,
    ...Object.entries(r.limits).map(([k, v]) => `# limit_${k},${v}`),
  ];
  return [head.join(','), ...rows, ...meta].join('\n');
}
