// Pre-run validation for the arbitrage backtest runner.
// Catches inconsistent risk limits, cooldown/smoothing settings and preset
// mismatches *before* a run burns time and produces misleading numbers.
import type { ArbBacktestConfig } from './arb-backtest';
import { ticksFromWindow } from './arb-backtest';
import type { ArbRiskLimits } from './arb-risk-config';
import type { DrawdownGuardConfig } from './drawdown-guard';

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  field: string;
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ok: boolean;
}

export function validateBacktestRun(
  cfg: ArbBacktestConfig,
  limits: ArbRiskLimits,
  guard: DrawdownGuardConfig,
  activePresetName?: string | null,
  presetConfig?: ArbBacktestConfig | null,
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message });

  // --- scenario window ---------------------------------------------------
  if (!Number.isFinite(cfg.startTime) || !Number.isFinite(cfg.endTime)) err('window', 'Start/end time is not a valid date.');
  else if (cfg.endTime <= cfg.startTime) err('window', 'End time must be after start time.');
  if (cfg.tickIntervalMs <= 0) err('tickInterval', 'Tick interval must be greater than zero.');
  const ticks = ticksFromWindow(cfg);
  if (cfg.endTime > cfg.startTime && cfg.tickIntervalMs > 0) {
    const raw = (cfg.endTime - cfg.startTime) / cfg.tickIntervalMs;
    if (raw < 10) warn('window', `Window yields only ${Math.round(raw)} ticks — clamped to ${ticks}; results will be noisy.`);
    if (raw > 5000) warn('window', `Window yields ${Math.round(raw)} ticks — clamped to ${ticks} for responsiveness.`);
  }
  if (cfg.marketsPerTick < 2) err('marketsPerTick', 'At least 2 markets per tick are required to form a structure.');
  if (!cfg.strategies.multiMarketArb && !cfg.strategies.polyswarm) err('strategies', 'Enable at least one strategy to run.');

  // --- effective risk limits --------------------------------------------
  const eff: ArbRiskLimits = { ...limits, ...cfg.riskOverrides };
  if (!eff.executionEnabled) err('executionEnabled', 'Execution is disabled — every signal would be blocked, producing an empty run.');
  if (eff.maxCapitalPerArb <= 0) err('maxCapitalPerArb', 'Max capital per arb must be positive.');
  if (eff.maxCapitalPerTick <= 0) err('maxCapitalPerTick', 'Max capital per tick must be positive.');
  if (eff.maxCapitalPerArb > eff.maxCapitalPerTick) {
    err('maxCapitalPerArb', `Cap per arb ($${eff.maxCapitalPerArb}) exceeds the tick cap ($${eff.maxCapitalPerTick}) — no trade can ever fill.`);
  }
  if (eff.maxExecutionsPerTick < 1) err('maxExecutionsPerTick', 'Max executions per tick must be at least 1.');
  if (eff.maxExecutionsPerTick * eff.maxCapitalPerArb > eff.maxCapitalPerTick * 4) {
    warn('maxExecutionsPerTick', 'Execution cap far exceeds what the tick capital cap can fund; the capital cap will dominate.');
  }
  if (eff.minConfidence < 0 || eff.minConfidence > 1) err('minConfidence', 'Min confidence must be between 0 and 1.');
  else if (eff.minConfidence > 0.97) warn('minConfidence', 'Confidence floor above 97% will block almost every signal.');
  if (eff.minProfit < 0) err('minProfit', 'Min profit cannot be negative.');
  if (eff.maxLegs < 2) err('maxLegs', 'Max legs must be at least 2.');
  if (eff.maxDailyArbLoss <= 0) err('maxDailyArbLoss', 'Daily arb loss cap must be positive.');
  if (eff.minSwarmEdge <= 0 && cfg.strategies.polyswarm) warn('minSwarmEdge', 'Swarm edge floor of 0 accepts noise as signal.');

  // --- costs -------------------------------------------------------------
  if (cfg.feeBps < 0 || cfg.slippageBps < 0) err('costs', 'Fee and slippage must be non-negative.');
  const costRate = (cfg.feeBps + cfg.slippageBps) / 10_000;
  if (costRate * eff.maxCapitalPerArb > eff.minProfit * 5 && eff.minProfit > 0) {
    warn('costs', `Modelled costs (~$${(costRate * eff.maxCapitalPerArb).toFixed(2)}/arb) dwarf the $${eff.minProfit} profit floor; expect negative net results.`);
  }
  if (cfg.feeBps + cfg.slippageBps === 0) warn('costs', 'Zero fees and slippage — results will be optimistic versus live fills.');

  // --- drawdown guard coherence -----------------------------------------
  if (guard.maxDrawdownPct <= 0 || guard.maxDrawdownPct >= 1) err('maxDrawdownPct', 'Max drawdown must be between 0 and 100%.');
  if (guard.resumeBufferPct >= guard.maxDrawdownPct) {
    err('resumeBufferPct', `Resume buffer (${(guard.resumeBufferPct * 100).toFixed(1)}%) must be smaller than the drawdown cap (${(guard.maxDrawdownPct * 100).toFixed(1)}%).`);
  }
  if (guard.breachTicks < 1) err('breachTicks', 'Breach confirmations must be at least 1.');
  if (guard.smoothingWindow < 1) err('smoothingWindow', 'Smoothing window must be at least 1 tick.');
  if (guard.smoothingWindow > 4 * guard.breachTicks * 10) {
    warn('smoothingWindow', 'Smoothing window is very long relative to the confirmation count — the guard will react slowly.');
  }
  if (guard.smoothingWindow >= ticks) {
    warn('smoothingWindow', `Smoothing window (${guard.smoothingWindow}) is as long as the run (${ticks} ticks); the guard may never confirm a breach.`);
  }
  if (guard.cooldownMinutes * 60_000 > cfg.endTime - cfg.startTime) {
    warn('cooldownMinutes', 'A single cooldown is longer than the whole scenario window.');
  }

  // --- preset compatibility ---------------------------------------------
  if (activePresetName && presetConfig) {
    const drift = (Object.keys(presetConfig) as (keyof ArbBacktestConfig)[]).filter(k => {
      if (k === 'riskOverrides' || k === 'strategies') return JSON.stringify(presetConfig[k]) !== JSON.stringify(cfg[k]);
      return presetConfig[k] !== cfg[k];
    });
    if (drift.length) {
      warn('preset', `Config drifted from scenario "${activePresetName}" (${drift.join(', ')}) — save it to keep the run reproducible.`);
    }
  }

  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');
  return { issues, errors, warnings, ok: errors.length === 0 };
}
