// Last-used audit export/filter settings, restored when the panel reopens.

export interface AuditExportPrefs {
  rangeMs: number;
  action: 'all' | 'executed' | 'blocked';
  strategy: 'all' | 'multi_market_arb' | 'polyswarm';
  mode: 'all' | 'paper' | 'live';
  reason: string;
  search: string;
  format: 'csv' | 'json';
  pageSize: number;
}

export const DEFAULT_AUDIT_PREFS: AuditExportPrefs = {
  rangeMs: 24 * 60 * 60 * 1000,
  action: 'all',
  strategy: 'all',
  mode: 'all',
  reason: '',
  search: '',
  format: 'csv',
  pageSize: 25,
};

const KEY = 'arb-audit-export-prefs-v1';

export function loadAuditPrefs(): AuditExportPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return { ...DEFAULT_AUDIT_PREFS, ...obj };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_AUDIT_PREFS };
}

export function saveAuditPrefs(prefs: Partial<AuditExportPrefs>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadAuditPrefs(), ...prefs })); } catch { /* ignore */ }
}
