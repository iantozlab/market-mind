import { useCallback, useEffect, useState } from 'react';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface AlertItem {
  id: string;
  ts: number;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  read?: boolean;
}

const MAX = 60;

export function useAlertsCenter() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);

  const push = useCallback((a: Omit<AlertItem, 'id' | 'ts' | 'read'>) => {
    setAlerts(prev => [{ ...a, id: crypto.randomUUID(), ts: Date.now(), read: false }, ...prev].slice(0, MAX));
  }, []);

  const markAllRead = useCallback(() => setAlerts(prev => prev.map(a => ({ ...a, read: true }))), []);
  const clear = useCallback(() => setAlerts([]), []);

  useEffect(() => {
    if (open) markAllRead();
  }, [open, markAllRead]);

  const unread = alerts.filter(a => !a.read).length;
  return { alerts, push, unread, open, setOpen, clear };
}
