// Persistent audit log for trade settings changes (localStorage-backed).
import type { TradeSettings } from './neural-bot-engine';

export interface AuditChange {
  field: keyof TradeSettings;
  before: number;
  after: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  actor: string;
  changes: AuditChange[];
}

const KEY = 'trade_settings_audit_v1';
const MAX = 200;

export const FIELD_LABELS: Record<keyof TradeSettings, string> = {
  entryWindowMs: 'Entry Window (ms)',
  exitWindowMs: 'Exit Window (ms)',
  kellyFraction: 'Kelly Fraction',
  maxPositionPct: 'Max Position %',
  stopLossPct: 'Stop Loss %',
  takeProfitPct: 'Take Profit %',
  maxDailyLoss: 'Max Daily Loss ($)',
  maxDrawdown: 'Max Drawdown',
};

const PCT_FIELDS: Set<keyof TradeSettings> = new Set([
  'kellyFraction', 'maxPositionPct', 'stopLossPct', 'takeProfitPct', 'maxDrawdown',
]);

export const fmtValue = (field: keyof TradeSettings, v: number): string => {
  if (PCT_FIELDS.has(field)) return `${(v * 100).toFixed(2)}%`;
  if (field === 'maxDailyLoss') return `$${v.toFixed(0)}`;
  return String(v);
};

export const diffSettings = (
  prev: TradeSettings,
  next: Partial<TradeSettings>,
): AuditChange[] => {
  const out: AuditChange[] = [];
  for (const k of Object.keys(next) as (keyof TradeSettings)[]) {
    const before = prev[k];
    const after = next[k];
    if (after == null || before === after) continue;
    out.push({ field: k, before, after });
  }
  return out;
};

export const loadAuditLog = (): AuditEntry[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as AuditEntry[] : [];
  } catch { return []; }
};

export const appendAudit = (entry: Omit<AuditEntry, 'id' | 'ts'>): AuditEntry => {
  const e: AuditEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
  const list = [e, ...loadAuditLog()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* noop */ }
  return e;
};

export const clearAudit = () => {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
};
