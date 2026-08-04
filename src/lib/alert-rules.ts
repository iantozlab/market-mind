// Notification rules for strategy-health alerts: global mute, rate limiting,
// severity floor and per-strategy toggles. Persisted to localStorage so the
// operator's noise preferences survive reloads.

export interface AlertRules {
  /** Global mute — nothing reaches the bell while true (until muteUntil passes). */
  muted: boolean;
  /** Epoch ms; when > now the center is temporarily snoozed. */
  muteUntil: number;
  /** Minimum severity that is allowed through. */
  minSeverity: 'info' | 'warning' | 'critical';
  /** Max alerts accepted per rolling minute (0 = unlimited). */
  maxPerMinute: number;
  /** Suppress an identical title for this many seconds. */
  dedupeWindowSec: number;
  /** Per-strategy enable map. Missing key = enabled. */
  strategies: Record<string, boolean>;
}

export const KNOWN_ALERT_STRATEGIES = [
  'polyswarm',
  'multi_market_arb',
  'bot_exhaustion',
  'liquidity_vortex',
  'gas_shadow',
  'rans',
  'risk',
] as const;

export const DEFAULT_ALERT_RULES: AlertRules = {
  muted: false,
  muteUntil: 0,
  minSeverity: 'info',
  maxPerMinute: 12,
  dedupeWindowSec: 45,
  strategies: {},
};

const KEY = 'alert-rules-v1';
const SEV_RANK = { info: 0, warning: 1, critical: 2 } as const;

function load(): AlertRules {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_ALERT_RULES, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_ALERT_RULES };
}

let rules: AlertRules = load();
const subs = new Set<(r: AlertRules) => void>();

export function getAlertRules(): AlertRules { return { ...rules, strategies: { ...rules.strategies } }; }

export function setAlertRules(patch: Partial<AlertRules>): AlertRules {
  rules = { ...rules, ...patch, strategies: { ...rules.strategies, ...(patch.strategies ?? {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn(getAlertRules()); } catch { /* ignore */ } });
  return getAlertRules();
}

export function resetAlertRules(): AlertRules {
  rules = { ...DEFAULT_ALERT_RULES, strategies: {} };
  try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn(getAlertRules()); } catch { /* ignore */ } });
  return getAlertRules();
}

export function subscribeAlertRules(fn: (r: AlertRules) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function isStrategyEnabled(strategy?: string): boolean {
  if (!strategy) return true;
  return rules.strategies[strategy] !== false;
}

/** Rolling-window state for rate limiting + dedupe. */
let recentTs: number[] = [];
const lastTitleTs = new Map<string, number>();

export interface AlertFilterResult { allowed: boolean; reason?: string }

export function evaluateAlert(a: { severity: 'info' | 'warning' | 'critical'; title: string; strategy?: string }): AlertFilterResult {
  const now = Date.now();
  if (rules.muted || rules.muteUntil > now) return { allowed: false, reason: 'muted' };
  if (SEV_RANK[a.severity] < SEV_RANK[rules.minSeverity]) return { allowed: false, reason: 'below severity floor' };
  if (!isStrategyEnabled(a.strategy)) return { allowed: false, reason: `strategy ${a.strategy} disabled` };

  const last = lastTitleTs.get(a.title) ?? 0;
  if (rules.dedupeWindowSec > 0 && now - last < rules.dedupeWindowSec * 1000) {
    return { allowed: false, reason: 'duplicate within dedupe window' };
  }

  recentTs = recentTs.filter(t => now - t < 60_000);
  if (rules.maxPerMinute > 0 && recentTs.length >= rules.maxPerMinute) {
    return { allowed: false, reason: 'rate limit' };
  }

  recentTs.push(now);
  lastTitleTs.set(a.title, now);
  return { allowed: true };
}

/** Counters for the "suppressed" badge in the notification center. */
let suppressed = 0;
export function noteSuppressed() { suppressed++; }
export function getSuppressedCount() { return suppressed; }
export function resetSuppressedCount() { suppressed = 0; }
