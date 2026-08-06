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

/* ---------------- shareable scenario links ---------------- */

export const SHARE_PARAM = 'scenario';

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(pad + '==='.slice((pad.length + 3) % 4))));
}

/** Serialize a named scenario into an opaque, URL-safe token. */
export function encodeScenario(name: string, config: ArbBacktestConfig): string {
  return b64urlEncode(JSON.stringify({ v: 1, name, config }));
}

/** Parse a scenario token back into a config, tolerating garbage input. */
export function decodeScenario(token: string): { name: string; config: ArbBacktestConfig } | null {
  try {
    const obj = JSON.parse(b64urlDecode(token));
    if (!obj || typeof obj !== 'object' || !obj.config) return null;
    return { name: String(obj.name ?? 'shared'), config: { ...DEFAULT_ARB_BACKTEST, ...obj.config } };
  } catch { return null; }
}

/** Full shareable URL for the current window. */
export function scenarioShareLink(name: string, config: ArbBacktestConfig): string {
  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_PARAM, encodeScenario(name, config));
  return url.toString();
}

/** Reads (and returns) a shared scenario from the current URL, if present. */
export function readSharedScenario(): { name: string; config: ArbBacktestConfig } | null {
  try {
    const token = new URL(window.location.href).searchParams.get(SHARE_PARAM);
    return token ? decodeScenario(token) : null;
  } catch { return null; }
}

