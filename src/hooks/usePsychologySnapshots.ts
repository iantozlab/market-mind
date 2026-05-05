import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PsychologyHealthRow } from '@/components/PsychologyHealthPanel';

export interface SnapshotPoint {
  t: number;
  winRate: number;
  trades: number;
  isHealthy: boolean;
}

const HISTORY_LIMIT = 60;

/**
 * Persists Psychology Health snapshots to Lovable Cloud every `intervalMs`
 * and exposes per-strategy time series for sparklines.
 */
export function usePsychologySnapshots(
  rows: PsychologyHealthRow[],
  isRunning: boolean,
  intervalMs = 15000,
) {
  const [history, setHistory] = useState<Record<string, SnapshotPoint[]>>({});
  const lastWriteRef = useRef(0);

  // Load recent history on mount
  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString();
      const { data } = await supabase
        .from('psychology_snapshots')
        .select('strategy_name, win_rate, trades, is_healthy, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(2000);
      if (!data) return;
      const grouped: Record<string, SnapshotPoint[]> = {};
      for (const r of data) {
        const key = r.strategy_name;
        (grouped[key] ||= []).push({
          t: new Date(r.created_at).getTime(),
          winRate: r.win_rate,
          trades: r.trades,
          isHealthy: r.is_healthy,
        });
      }
      for (const k of Object.keys(grouped)) {
        grouped[k] = grouped[k].slice(-HISTORY_LIMIT);
      }
      setHistory(grouped);
    })();
  }, []);

  // Append + persist
  useEffect(() => {
    if (!isRunning || rows.length === 0) return;
    const now = Date.now();
    if (now - lastWriteRef.current < intervalMs) return;
    lastWriteRef.current = now;

    setHistory(prev => {
      const next = { ...prev };
      for (const r of rows) {
        const arr = next[r.name] ? [...next[r.name]] : [];
        arr.push({ t: now, winRate: r.winRate, trades: r.trades, isHealthy: r.isHealthy });
        next[r.name] = arr.slice(-HISTORY_LIMIT);
      }
      return next;
    });

    // Fire-and-forget persist
    void supabase.from('psychology_snapshots').insert(
      rows.map(r => ({
        strategy_name: r.name,
        win_rate: r.winRate,
        trades: r.trades,
        is_healthy: r.isHealthy,
      })),
    );
  }, [rows, isRunning, intervalMs]);

  return history;
}
