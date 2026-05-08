// Persistent audit log for trade settings changes — Supabase + localStorage mirror.
import type { TradeSettings } from './neural-bot-engine';
import { supabase } from '@/integrations/supabase/client';

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

export const loadLocalAuditLog = (): AuditEntry[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as AuditEntry[] : [];
  } catch { return []; }
};

export const appendAudit = async (entry: Omit<AuditEntry, 'id' | 'ts'>): Promise<AuditEntry> => {
  const e: AuditEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
  // Mirror to localStorage
  const list = [e, ...loadLocalAuditLog()].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* noop */ }
  // Persist to Supabase (fire-and-forget, but await to surface errors in console)
  try {
    await supabase.from('trade_settings_audit').insert({
      actor: entry.actor,
      changes: entry.changes as unknown as Record<string, unknown>,
    });
  } catch { /* offline-tolerant */ }
  return e;
};

export interface AuditQuery {
  /** ISO string or ms timestamp */
  fromTs?: number;
  toTs?: number;
  limit?: number;
}

export const fetchAuditLog = async (q: AuditQuery = {}): Promise<AuditEntry[]> => {
  const limit = q.limit ?? 200;
  let query = supabase
    .from('trade_settings_audit')
    .select('id, actor, changes, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (q.fromTs) query = query.gte('created_at', new Date(q.fromTs).toISOString());
  if (q.toTs) query = query.lte('created_at', new Date(q.toTs).toISOString());
  const { data, error } = await query;
  if (error || !data) return loadLocalAuditLog();
  return data.map(r => ({
    id: r.id,
    ts: new Date(r.created_at).getTime(),
    actor: r.actor,
    changes: (r.changes as unknown as AuditChange[]) ?? [],
  }));
};

export const clearAudit = async () => {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  try { await supabase.from('trade_settings_audit').delete().gt('created_at', '1970-01-01'); } catch { /* noop */ }
};

// Backward-compat alias used by older imports.
export const loadAuditLog = loadLocalAuditLog;
