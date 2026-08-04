// Named risk-limit presets for the Arb & Swarm panel.
// Ships three built-ins (conservative / balanced / aggressive) and lets the
// operator save the current configuration as a custom preset. Persisted to
// localStorage alongside the active preset name.
import { DEFAULT_ARB_LIMITS, getArbLimits, setArbLimits, type ArbRiskLimits } from './arb-risk-config';

export interface ArbRiskPreset {
  name: string;
  builtin?: boolean;
  description?: string;
  limits: ArbRiskLimits;
}

export const BUILTIN_PRESETS: ArbRiskPreset[] = [
  {
    name: 'conservative',
    builtin: true,
    description: 'Small size, high confidence, few fills per tick.',
    limits: {
      ...DEFAULT_ARB_LIMITS,
      paperMode: true,
      maxCapitalPerArb: 150,
      maxCapitalPerTick: 600,
      minProfit: 0.15,
      minConfidence: 0.9,
      maxLegs: 3,
      maxExecutionsPerTick: 1,
      maxDailyArbLoss: 100,
      minSwarmEdge: 0.04,
      divergenceAlertThreshold: 0.1,
      anomalyAlertThreshold: 0.7,
    },
  },
  {
    name: 'balanced',
    builtin: true,
    description: 'Default limits — steady deployment with sane caps.',
    limits: { ...DEFAULT_ARB_LIMITS },
  },
  {
    name: 'aggressive',
    builtin: true,
    description: 'Larger size, lower bar to fire, more fills per tick.',
    limits: {
      ...DEFAULT_ARB_LIMITS,
      maxCapitalPerArb: 1200,
      maxCapitalPerTick: 5000,
      minProfit: 0.02,
      minConfidence: 0.65,
      maxLegs: 8,
      maxExecutionsPerTick: 6,
      maxDailyArbLoss: 600,
      minSwarmEdge: 0.012,
      divergenceAlertThreshold: 0.16,
      anomalyAlertThreshold: 0.85,
    },
  },
];

const CUSTOM_KEY = 'arb-risk-presets-v1';
const ACTIVE_KEY = 'arb-risk-preset-active-v1';

function loadCustom(): ArbRiskPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) return JSON.parse(raw) as ArbRiskPreset[];
  } catch { /* ignore */ }
  return [];
}

let custom: ArbRiskPreset[] = loadCustom();
const subs = new Set<() => void>();
function notify() { subs.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }
function persist() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom)); } catch { /* ignore */ }
  notify();
}

export function subscribeArbPresets(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function listArbPresets(): ArbRiskPreset[] { return [...BUILTIN_PRESETS, ...custom]; }

export function getActivePresetName(): string {
  try { return localStorage.getItem(ACTIVE_KEY) ?? 'balanced'; } catch { return 'balanced'; }
}

function setActivePresetName(name: string) {
  try { localStorage.setItem(ACTIVE_KEY, name); } catch { /* ignore */ }
}

export function applyArbPreset(name: string): ArbRiskLimits | null {
  const preset = listArbPresets().find(p => p.name === name);
  if (!preset) return null;
  setActivePresetName(name);
  // Keep the operator's live/paper switch — presets never silently go live.
  const current = getArbLimits();
  const next = setArbLimits({ ...preset.limits, paperMode: current.paperMode, executionEnabled: current.executionEnabled });
  notify();
  return next;
}

export function saveCurrentAsPreset(name: string, description?: string): ArbRiskPreset {
  const trimmed = name.trim() || `preset-${custom.length + 1}`;
  const preset: ArbRiskPreset = { name: trimmed, description, limits: getArbLimits() };
  custom = [...custom.filter(p => p.name !== trimmed), preset];
  persist();
  setActivePresetName(trimmed);
  return preset;
}

export function deleteArbPreset(name: string): void {
  custom = custom.filter(p => p.name !== name);
  persist();
  if (getActivePresetName() === name) setActivePresetName('balanced');
}
