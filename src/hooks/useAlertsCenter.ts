import { useCallback, useEffect, useState } from 'react';
import {
  evaluateAlert, noteSuppressed, getSuppressedCount, resetSuppressedCount,
  subscribeAlertRules, getAlertRules, type AlertRules,
} from '@/lib/alert-rules';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface AlertItem {
  id: string;
  ts: number;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  strategy?: string;
  read?: boolean;
}

const MAX = 60;

export function useAlertsCenter() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);
  const [rules, setRulesState] = useState<AlertRules>(() => getAlertRules());
  const [suppressed, setSuppressed] = useState(0);

  useEffect(() => subscribeAlertRules(setRulesState), []);

  const push = useCallback((a: Omit<AlertItem, 'id' | 'ts' | 'read'>) => {
    const verdict = evaluateAlert(a);
    if (!verdict.allowed) {
      noteSuppressed();
      setSuppressed(getSuppressedCount());
      return;
    }
    setAlerts(prev => [{ ...a, id: crypto.randomUUID(), ts: Date.now(), read: false }, ...prev].slice(0, MAX));
  }, []);

  const markRead = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, read: true } : a)));
  }, []);

  const markAllRead = useCallback(() => {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  }, []);

  const clear = useCallback(() => setAlerts([]), []);

  const clearSuppressed = useCallback(() => { resetSuppressedCount(); setSuppressed(0); }, []);

  const unread = alerts.filter(a => !a.read).length;
  return { alerts, push, unread, open, setOpen, clear, markRead, markAllRead, rules, suppressed, clearSuppressed };
}
