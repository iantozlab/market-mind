import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { BotMetrics } from '@/lib/neural-bot-engine';


const SESSION_KEY = 'metrics_session_id_v1';
const QUEUE_KEY = 'metrics_offline_queue_v1';

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function loadQueue(): Record<string, unknown>[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(q: Record<string, unknown>[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-200))); } catch { /* noop */ }
}

export interface MetricsPersistenceStatus {
  sessionId: string;
  lastSavedAt: number | null;
  lastError: string | null;
  queueDepth: number;
  isFlushing: boolean;
}

/**
 * Periodically persists bot metrics snapshots to Supabase.
 * Offline-safe: failed inserts are queued in localStorage and retried with backoff.
 */
export function useMetricsPersistence(
  metrics: BotMetrics,
  isRunning: boolean,
  intervalMs: number = 30_000,
): MetricsPersistenceStatus {
  const [status, setStatus] = useState<MetricsPersistenceStatus>(() => ({
    sessionId: getSessionId(),
    lastSavedAt: null,
    lastError: null,
    queueDepth: loadQueue().length,
    isFlushing: false,
  }));
  const lastSent = useRef(0);
  const backoff = useRef(0);

  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    const flush = async () => {
      if (Date.now() - lastSent.current < intervalMs) return;
      if (Date.now() < backoff.current) return;
      lastSent.current = Date.now();

      const row = {
        session_id: status.sessionId,
        total_pnl: metrics.totalPnL,
        daily_pnl: metrics.dailyPnL,
        win_rate: metrics.winRate,
        sharpe_ratio: metrics.sharpeRatio,
        max_drawdown: metrics.maxDrawdown,
        active_positions: metrics.activePositions,
        trades_executed: metrics.tradesExecuted,
        markets_monitored: metrics.marketsMonitored,
        anomaly_score: metrics.anomalyScore,
        extra: { bot_detection_accuracy: metrics.botDetectionAccuracy, queued_at: Date.now() },
      };

      const queue = loadQueue();
      queue.push(row);
      setStatus(s => ({ ...s, isFlushing: true, queueDepth: queue.length }));

      try {
        // batch insert everything queued
        const { error } = await supabase.from('metrics_snapshots' as never).insert(queue as never);
        if (error) throw error;
        saveQueue([]);
        backoff.current = 0;
        if (!cancelled) setStatus(s => ({
          ...s,
          lastSavedAt: Date.now(),
          lastError: null,
          queueDepth: 0,
          isFlushing: false,
        }));
      } catch (e) {
        // keep queue, exponential backoff up to 5 min
        saveQueue(queue);
        const delay = Math.min(300_000, 5_000 * Math.pow(2, Math.min(6, Math.floor(queue.length / 3))));
        backoff.current = Date.now() + delay;
        if (!cancelled) setStatus(s => ({
          ...s,
          lastError: e instanceof Error ? e.message : String(e),
          queueDepth: queue.length,
          isFlushing: false,
        }));
      }
    };

    const id = setInterval(flush, Math.max(5_000, intervalMs));
    return () => { cancelled = true; clearInterval(id); };
  }, [metrics, isRunning, intervalMs, status.sessionId]);

  return status;
}
