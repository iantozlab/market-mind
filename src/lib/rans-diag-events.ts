// RANS diagnostics event persistence — writes to Supabase `rans_diagnostic_events`.
// Untyped access (table not in generated types until next regen); safe via `as any`.
import { supabase } from '@/integrations/supabase/client';

export type RansDiagEventType =
  | 'signal_dropout'
  | 'guardrail_clamp'
  | 'kill_switch'
  | 'kill_switch_resume'
  | 'regime_change';

export interface RansDiagEvent {
  id?: string;
  event_type: RansDiagEventType | string;
  severity: 'info' | 'warning' | 'critical';
  detail: Record<string, unknown>;
  created_at?: string;
}

const TABLE = 'rans_diagnostic_events';
const db = () => (supabase as any).from(TABLE);

let pending: RansDiagEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const batch = pending.splice(0, pending.length);
    if (batch.length === 0) return;
    try { await db().insert(batch); } catch { /* offline tolerant */ }
  }, 750);
}

export function recordRansDiagEvent(ev: RansDiagEvent) {
  pending.push({ ...ev, detail: ev.detail ?? {} });
  scheduleFlush();
}

export interface RansDiagQuery {
  fromIso?: string;
  toIso?: string;
  types?: RansDiagEventType[];
  limit?: number;
}

export async function queryRansDiagEvents(q: RansDiagQuery = {}): Promise<RansDiagEvent[]> {
  try {
    let req = db().select('*').order('created_at', { ascending: false }).limit(q.limit ?? 200);
    if (q.fromIso) req = req.gte('created_at', q.fromIso);
    if (q.toIso) req = req.lte('created_at', q.toIso);
    if (q.types && q.types.length) req = req.in('event_type', q.types);
    const { data, error } = await req;
    if (error) throw error;
    return (data ?? []) as RansDiagEvent[];
  } catch {
    return [];
  }
}
