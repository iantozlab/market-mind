// Configurable drawdown guard: threshold, cooldown duration and smoothing window.
// Persisted to localStorage so the engine and dashboard agree across reloads.

export interface DrawdownGuardConfig {
  /** Drawdown fraction (0..1) that engages the cooldown. */
  maxDrawdownPct: number;
  /** How long trading pauses once the guard fires (minutes). */
  cooldownMinutes: number;
  /** Number of ticks in the EMA smoothing window — larger = calmer gauge. */
  smoothingWindow: number;
  /** Consecutive smoothed breaches required before the cooldown engages. */
  breachTicks: number;
  /** After a cooldown, drawdown must fall this far below the cap before re-arming. */
  resumeBufferPct: number;
}

export const DEFAULT_DRAWDOWN_GUARD: DrawdownGuardConfig = {
  maxDrawdownPct: 0.15,
  cooldownMinutes: 15,
  smoothingWindow: 8,
  breachTicks: 3,
  resumeBufferPct: 0.02,
};

const KEY = 'drawdown-guard-v1';

function clampCfg(c: DrawdownGuardConfig): DrawdownGuardConfig {
  return {
    maxDrawdownPct: Math.min(0.9, Math.max(0.01, c.maxDrawdownPct)),
    cooldownMinutes: Math.min(720, Math.max(1, c.cooldownMinutes)),
    smoothingWindow: Math.min(200, Math.max(1, Math.round(c.smoothingWindow))),
    breachTicks: Math.min(50, Math.max(1, Math.round(c.breachTicks))),
    resumeBufferPct: Math.min(0.5, Math.max(0, c.resumeBufferPct)),
  };
}

function load(): DrawdownGuardConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return clampCfg({ ...DEFAULT_DRAWDOWN_GUARD, ...JSON.parse(raw) });
  } catch { /* ignore */ }
  return { ...DEFAULT_DRAWDOWN_GUARD };
}

let cfg: DrawdownGuardConfig = load();
const subs = new Set<(c: DrawdownGuardConfig) => void>();

export function getDrawdownGuard(): DrawdownGuardConfig { return { ...cfg }; }

export function setDrawdownGuard(patch: Partial<DrawdownGuardConfig>): DrawdownGuardConfig {
  cfg = clampCfg({ ...cfg, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn({ ...cfg }); } catch { /* ignore */ } });
  return { ...cfg };
}

export function resetDrawdownGuard(): DrawdownGuardConfig {
  return setDrawdownGuard(DEFAULT_DRAWDOWN_GUARD);
}

export function subscribeDrawdownGuard(fn: (c: DrawdownGuardConfig) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** EMA alpha derived from the smoothing window. */
export function smoothingAlpha(): number {
  return 2 / (cfg.smoothingWindow + 1);
}
