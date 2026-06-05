// RANS diagnostics event persistence — writes to Supabase `rans_diagnostic_events`.
// Untyped access (table not in generated types until next regen); safe via `as any`.
import { supabase } from '@/integrations/supabase/client';

export type RansDiagEventType =
  | 'signal_dropout'
  | 'guardrail_clamp'
  | 'kill_switch'
  | 'kill_switch_resume'
  | 'regime_change'
  | 'guardrail_burst';

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
  // Optional external notification (kill switch + guardrail bursts only).
  if (ev.event_type === 'kill_switch' || ev.event_type === 'guardrail_burst') {
    notifyExternal(ev).catch(() => { /* ignore */ });
  }
}

export interface RansDiagQuery {
  fromIso?: string;
  toIso?: string;
  types?: RansDiagEventType[];
  limit?: number;
  offset?: number;
  /** Free-text search across event_type, severity, regime, alert title and detail JSON. */
  search?: string;
  /** Filter by regime stored inside detail.regime. */
  regime?: string;
}

export async function queryRansDiagEvents(q: RansDiagQuery = {}): Promise<RansDiagEvent[]> {
  try {
    const limit = q.limit ?? 200;
    const offset = q.offset ?? 0;
    let req = db().select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (q.fromIso) req = req.gte('created_at', q.fromIso);
    if (q.toIso) req = req.lte('created_at', q.toIso);
    if (q.types && q.types.length) req = req.in('event_type', q.types);
    const { data, error } = await req;
    if (error) throw error;
    let rows = (data ?? []) as RansDiagEvent[];
    if (q.regime) {
      rows = rows.filter(r => String((r.detail as any)?.regime ?? '').toLowerCase() === q.regime!.toLowerCase());
    }
    if (q.search && q.search.trim()) {
      const needle = q.search.trim().toLowerCase();
      rows = rows.filter(r => {
        const hay = `${r.event_type} ${r.severity} ${JSON.stringify(r.detail ?? {})}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function countRansDiagEvents(q: RansDiagQuery = {}): Promise<number> {
  try {
    let req = db().select('*', { count: 'exact', head: true });
    if (q.fromIso) req = req.gte('created_at', q.fromIso);
    if (q.toIso) req = req.lte('created_at', q.toIso);
    if (q.types && q.types.length) req = req.in('event_type', q.types);
    const { count, error } = await req;
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ----------- External notification hooks (webhook + mailto) -----------
// Settings stored in localStorage so users can wire Slack/Zapier/their own webhook
// without server-side secret management. Same payload used for kill-switch and
// guardrail clamp bursts.
const LS_WEBHOOK = 'rans:notify:webhook';
const LS_EMAIL = 'rans:notify:email';
const LS_ENABLED = 'rans:notify:enabled';

export interface NotifySettings {
  enabled: boolean;
  webhookUrl: string;
  email: string;
}

export function getNotifySettings(): NotifySettings {
  if (typeof localStorage === 'undefined') return { enabled: false, webhookUrl: '', email: '' };
  return {
    enabled: localStorage.getItem(LS_ENABLED) === '1',
    webhookUrl: localStorage.getItem(LS_WEBHOOK) ?? '',
    email: localStorage.getItem(LS_EMAIL) ?? '',
  };
}

export function setNotifySettings(s: NotifySettings) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_ENABLED, s.enabled ? '1' : '0');
  localStorage.setItem(LS_WEBHOOK, s.webhookUrl);
  localStorage.setItem(LS_EMAIL, s.email);
}

export async function notifyExternal(ev: RansDiagEvent): Promise<void> {
  const cfg = getNotifySettings();
  if (!cfg.enabled) return;
  const payload = {
    source: 'RANS',
    event_type: ev.event_type,
    severity: ev.severity,
    title: ev.event_type === 'kill_switch'
      ? `RANS kill switch engaged: ${(ev.detail as any)?.reason ?? 'unknown'}`
      : `RANS guardrail clamp burst (${(ev.detail as any)?.count ?? '?'} in ${(ev.detail as any)?.windowMs ?? '?'}ms)`,
    detail: ev.detail,
    at: new Date().toISOString(),
  };
  if (cfg.webhookUrl) {
    try {
      await fetch(cfg.webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* tolerant */ }
  }
  if (cfg.email && typeof window !== 'undefined') {
    // Best-effort: surface a mailto so the user can capture the payload off the
    // bot without backend infra. Suppressed if multiple bursts arrive in <30s.
    const last = Number(sessionStorage.getItem('rans:notify:lastMail') ?? 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem('rans:notify:lastMail', String(Date.now()));
      const subject = encodeURIComponent(`[${payload.severity.toUpperCase()}] ${payload.title}`);
      const body = encodeURIComponent(JSON.stringify(payload, null, 2));
      const link = document.createElement('a');
      link.href = `mailto:${cfg.email}?subject=${subject}&body=${body}`;
      link.rel = 'noopener';
      link.click();
    }
  }
}
