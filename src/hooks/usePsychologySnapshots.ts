import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PsychologyHealthRow } from '@/components/PsychologyHealthPanel';

export interface SnapshotPoint {
  t: number;
  winRate: number;
  trades: number;
  isHealthy: boolean;
}

export interface SnapshotSettings {
  /** Polling/persist interval in ms */
  intervalMs: number;
  /** Retention window in hours; older rows are pruned */
  retentionHours: number;
  /** Hard cap on points kept in memory per strategy for sparklines */
  historyLimit: number;
}

const DEFAULTS: SnapshotSettings = { intervalMs: 15000, retentionHours: 24, historyLimit: 120 };
const STORAGE_KEY = 'psychology_snapshot_settings_v1';

function loadSettings(): SnapshotSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULTS;
}

export function usePsychologySnapshots(rows: PsychologyHealthRow[], isRunning: boolean) {
  const [settings, setSettingsState] = useState<SnapshotSettings>(loadSettings);
  const [history, setHistory] = useState<Record<string, SnapshotPoint[]>>({});
  const lastWriteRef = useRef(0);
  const lastPruneRef = useRef(0);

  const setSettings = useCallback((patch: Partial<SnapshotSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Load history when retention window changes
  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 1000 * 60 * 60 * settings.retentionHours).toISOString();
      const { data } = await supabase
        .from('psychology_snapshots')
        .select('strategy_name, win_rate, trades, is_healthy, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(5000);
      if (!data) return;
      const grouped: Record<string, SnapshotPoint[]> = {};
      for (const r of data) {
        (grouped[r.strategy_name] ||= []).push({
          t: new Date(r.created_at).getTime(),
          winRate: r.win_rate,
          trades: r.trades,
          isHealthy: r.is_healthy,
        });
      }
      for (const k of Object.keys(grouped)) grouped[k] = grouped[k].slice(-settings.historyLimit);
      setHistory(grouped);
    })();
  }, [settings.retentionHours, settings.historyLimit]);

  // Append + persist on cadence
  useEffect(() => {
    if (!isRunning || rows.length === 0) return;
    const now = Date.now();
    if (now - lastWriteRef.current < settings.intervalMs) return;
    lastWriteRef.current = now;

    setHistory(prev => {
      const next = { ...prev };
      for (const r of rows) {
        const arr = next[r.name] ? [...next[r.name]] : [];
        arr.push({ t: now, winRate: r.winRate, trades: r.trades, isHealthy: r.isHealthy });
        next[r.name] = arr.slice(-settings.historyLimit);
      }
      return next;
    });

    void supabase.from('psychology_snapshots').insert(
      rows.map(r => ({
        strategy_name: r.name,
        win_rate: r.winRate,
        trades: r.trades,
        is_healthy: r.isHealthy,
      })),
    );

    // Prune old rows at most once per hour
    if (now - lastPruneRef.current > 1000 * 60 * 60) {
      lastPruneRef.current = now;
      const cutoff = new Date(now - 1000 * 60 * 60 * settings.retentionHours).toISOString();
      void supabase.from('psychology_snapshots').delete().lt('created_at', cutoff);
    }
  }, [rows, isRunning, settings.intervalMs, settings.retentionHours, settings.historyLimit]);

  const pruneNow = useCallback(async () => {
    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * settings.retentionHours).toISOString();
    await supabase.from('psychology_snapshots').delete().lt('created_at', cutoff);
  }, [settings.retentionHours]);

  return { history, settings, setSettings, pruneNow };
}
