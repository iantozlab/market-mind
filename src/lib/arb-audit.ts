// Execution audit log for simulated (paper) arbitrage + swarm actions.
// Buffered writes to Supabase `arb_execution_audit`, with an in-memory mirror
// so the panel stays responsive/offline-tolerant.
import { supabase } from '@/integrations/supabase/client';

export type ArbAuditSource = 'multi_market_arb' | 'polyswarm';
export type ArbAuditAction = 'executed' | 'blocked' | 'signal';

export interface ArbAuditEntry {
  id?: string;
  session_id: string;
  source: ArbAuditSource | string;
  action: ArbAuditAction | string;
  mode: 'paper' | 'live';
  label: string;
  legs: number;
  profit: number;
  capital: number;
  confidence: number;
  reason: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

const TABLE = 'arb_execution_audit';
const db = () => (supabase as any).from(TABLE);
const MAX_LOCAL = 500;

let local: ArbAuditEntry[] = [];
let pending: ArbAuditEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(rows: ArbAuditEntry[]) => void>();

export const AUDIT_SESSION_ID =
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())).slice(0, 8);

function notify() { subs.forEach(fn => { try { fn([...local]); } catch { /* ignore */ } }); }

function flushSoon() {
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const batch = pending.splice(0, pending.length);
    if (!batch.length) return;
    try { await db().insert(batch.map(({ id, ...rest }) => rest)); } catch { /* offline tolerant */ }
  }, 900);
}

export function recordArbAudit(
  e: Omit<ArbAuditEntry, 'created_at' | 'session_id' | 'detail' | 'reason'> &
    Partial<Pick<ArbAuditEntry, 'detail' | 'reason' | 'created_at'>>,
): ArbAuditEntry {
  const row: ArbAuditEntry = {
    session_id: AUDIT_SESSION_ID,
    reason: e.reason ?? null,
    detail: e.detail ?? {},
    created_at: e.created_at ?? new Date().toISOString(),
    ...e,
  } as ArbAuditEntry;
  local = [row, ...local].slice(0, MAX_LOCAL);
  pending.push(row);
  flushSoon();
  notify();
  return row;
}

export function getLocalArbAudit(): ArbAuditEntry[] { return [...local]; }
export function clearLocalArbAudit(): void { local = []; notify(); }
export function subscribeArbAudit(fn: (rows: ArbAuditEntry[]) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export async function fetchArbAudit(sinceMs: number, limit = 200): Promise<ArbAuditEntry[]> {
  try {
    let q = db().select('*').order('created_at', { ascending: false }).limit(limit);
    if (sinceMs > 0) q = q.gte('created_at', new Date(Date.now() - sinceMs).toISOString());
    const { data, error } = await q;
    if (error || !data) return getLocalArbAudit();
    return data as ArbAuditEntry[];
  } catch {
    return getLocalArbAudit();
  }
}

export async function purgeArbAudit(): Promise<void> {
  clearLocalArbAudit();
  try { await db().delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch { /* ignore */ }
}

export function arbAuditToCsv(rows: ArbAuditEntry[]): string {
  const head = ['created_at', 'mode', 'source', 'action', 'label', 'legs', 'profit', 'capital', 'confidence', 'reason'];
  const body = rows.map(r => [
    r.created_at, r.mode, r.source, r.action, `"${(r.label ?? '').replace(/"/g, '""')}"`,
    r.legs, r.profit.toFixed(4), r.capital.toFixed(2), r.confidence.toFixed(3), `"${r.reason ?? ''}"`,
  ].join(','));
  return [head.join(','), ...body].join('\n');
}

export interface ArbAuditFilter {
  /** Lookback window in ms; 0 = everything held. */
  sinceMs?: number;
  /** 'all' or a specific source tag. */
  strategy?: string;
  action?: 'all' | 'executed' | 'blocked' | 'signal';
  mode?: 'all' | 'paper' | 'live';
  /** Only blocked rows whose reason matches (substring, case-insensitive). */
  reason?: string;
}

export function filterArbAudit(rows: ArbAuditEntry[], f: ArbAuditFilter): ArbAuditEntry[] {
  const cutoff = f.sinceMs && f.sinceMs > 0 ? Date.now() - f.sinceMs : 0;
  const needle = (f.reason ?? '').trim().toLowerCase();
  return rows.filter(r => {
    if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
    if (f.strategy && f.strategy !== 'all' && r.source !== f.strategy) return false;
    if (f.action && f.action !== 'all' && r.action !== f.action) return false;
    if (f.mode && f.mode !== 'all' && r.mode !== f.mode) return false;
    if (needle && !(r.reason ?? '').toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Flat, export-friendly rows (detail expanded) for CSV/JSON downloads. */
export function arbAuditExportRows(rows: ArbAuditEntry[]): Record<string, unknown>[] {
  return rows.map(r => ({
    created_at: r.created_at,
    mode: r.mode,
    strategy: (r.detail as Record<string, unknown> | undefined)?.strategy ?? r.source,
    source: r.source,
    action: r.action,
    label: r.label,
    legs: r.legs,
    profit: Number(r.profit.toFixed(4)),
    capital: Number(r.capital.toFixed(2)),
    confidence: Number(r.confidence.toFixed(3)),
    reason: r.reason ?? '',
    detail: JSON.stringify(r.detail ?? {}),
  }));
}

