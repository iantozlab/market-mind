// Named, persisted backtest scenarios so runs are reproducible.
import { DEFAULT_ARB_BACKTEST, type ArbBacktestConfig } from './arb-backtest';

export interface ArbBacktestPreset {
  name: string;
  savedAt: number;
  config: ArbBacktestConfig;
}

const KEY = 'arb-backtest-presets-v1';
const ACTIVE_KEY = 'arb-backtest-preset-active';
const subs = new Set<() => void>();

function read(): ArbBacktestPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as ArbBacktestPreset[];
    }
  } catch { /* ignore */ }
  return [];
}

function write(list: ArbBacktestPreset[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

export function listBacktestPresets(): ArbBacktestPreset[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveBacktestPreset(name: string, config: ArbBacktestConfig): ArbBacktestPreset {
  const clean = name.trim() || `scenario-${new Date().toISOString().slice(11, 16)}`;
  const entry: ArbBacktestPreset = { name: clean, savedAt: Date.now(), config: { ...config } };
  write([entry, ...read().filter(p => p.name !== clean)]);
  setActiveBacktestPreset(clean);
  return entry;
}

export function deleteBacktestPreset(name: string): void {
  write(read().filter(p => p.name !== name));
  if (getActiveBacktestPreset() === name) setActiveBacktestPreset(null);
}

export function getBacktestPreset(name: string): ArbBacktestConfig | null {
  const p = read().find(x => x.name === name);
  return p ? { ...DEFAULT_ARB_BACKTEST, ...p.config } : null;
}

export function getActiveBacktestPreset(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveBacktestPreset(name: string | null): void {
  try {
    if (name) localStorage.setItem(ACTIVE_KEY, name);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
  subs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}

export function subscribeBacktestPresets(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
