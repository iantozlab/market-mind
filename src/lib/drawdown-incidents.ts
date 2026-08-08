// Drawdown incident ledger: every guard breach, the confirmations that led to it,
// the cooldown window and the guard settings that were in force at the time.
// Persisted locally so the timeline survives refreshes.

export interface DrawdownIncident {
  id: string;
  /** First tick of the streak that produced this breach. */
  breachStartTs: number;
  /** When the cooldown engaged. */
  cooldownStart: number;
  /** Planned cooldown end. */
  cooldownEnd: number;
  reason: 'max-drawdown' | 'daily-loss-limit' | string;
  /** Consecutive confirmed breaches before the guard fired. */
  confirmations: number;
  /** Smoothed drawdown at trip time (0..1). */
  drawdownAtTrip: number;
  /** Level the gauge was re-armed at after applying the resume buffer. */
  resumeLevel: number;
  /** Guard settings used. */
  maxDrawdownPct: number;
  breachTicks: number;
  smoothingWindow: number;
  resumeBufferPct: number;
  cooldownMinutes: number;
  tick: number;
  /** Strategy scope that tripped the guard; 'global' when the portfolio guard fired. */
  strategy?: string;
}

export interface DrawdownIncidentFilter {
  /** Incident type / reason, or 'all'. */
  reason?: string;
  /** Strategy tag, or 'all'. */
  strategy?: string;
  /** Inclusive epoch-ms bounds on cooldownStart. */
  fromMs?: number;
  toMs?: number;
}

export function filterDrawdownIncidents(rows: DrawdownIncident[], f: DrawdownIncidentFilter): DrawdownIncident[] {
  return rows.filter(r => {
    if (f.reason && f.reason !== 'all' && r.reason !== f.reason) return false;
    if (f.strategy && f.strategy !== 'all' && (r.strategy ?? 'global') !== f.strategy) return false;
    if (f.fromMs && r.cooldownStart < f.fromMs) return false;
    if (f.toMs && r.cooldownStart > f.toMs) return false;
    return true;
  });
}


const KEY = 'drawdown-incidents-v1';
const MAX = 200;

function load(): DrawdownIncident[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as DrawdownIncident[];
    }
  } catch { /* ignore */ }
  return [];
}

let incidents: DrawdownIncident[] = load();
const subs = new Set<(rows: DrawdownIncident[]) => void>();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(incidents.slice(0, MAX))); } catch { /* ignore */ }
  subs.forEach(fn => { try { fn([...incidents]); } catch { /* ignore */ } });
}

export function recordDrawdownIncident(i: Omit<DrawdownIncident, 'id'>): DrawdownIncident {
  const row: DrawdownIncident = {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    ...i,
  };
  incidents = [row, ...incidents].slice(0, MAX);
  persist();
  return row;
}

export function getDrawdownIncidents(): DrawdownIncident[] { return [...incidents]; }

export function clearDrawdownIncidents(): void { incidents = []; persist(); }

export function subscribeDrawdownIncidents(fn: (rows: DrawdownIncident[]) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function drawdownIncidentsToCsv(rows: DrawdownIncident[]): string {
  const head = [
    'breach_start', 'cooldown_start', 'cooldown_end', 'reason', 'confirmations',
    'drawdown_at_trip_pct', 'resume_level_pct', 'max_drawdown_pct', 'breach_ticks',
    'smoothing_window', 'resume_buffer_pct', 'cooldown_minutes', 'tick',
  ];
  const body = rows.map(r => [
    new Date(r.breachStartTs).toISOString(), new Date(r.cooldownStart).toISOString(),
    new Date(r.cooldownEnd).toISOString(), r.reason, r.confirmations,
    (r.drawdownAtTrip * 100).toFixed(2), (r.resumeLevel * 100).toFixed(2),
    (r.maxDrawdownPct * 100).toFixed(2), r.breachTicks, r.smoothingWindow,
    (r.resumeBufferPct * 100).toFixed(2), r.cooldownMinutes, r.tick,
  ].join(','));
  return [head.join(','), ...body].join('\n');
}
