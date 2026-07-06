import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { BotMetrics } from '@/lib/neural-bot-engine';

const SESSION_KEY = 'metrics_session_id_v1';

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

/**
 * Periodically persists bot metrics snapshots to Supabase so charts and
 * diagnostics survive refresh and multi-day sessions can be analysed.
 */
export function useMetricsPersistence(metrics: BotMetrics, isRunning: boolean, intervalMs: number = 30_000) {
  const lastSent = useRef(0);
  const sessionId = useRef<string>(getSessionId());

  useEffect(() => {
    if (!isRunning) return;
    const flush = async () => {
      if (Date.now() - lastSent.current < intervalMs) return;
      lastSent.current = Date.now();
      try {
        await supabase.from('metrics_snapshots' as never).insert({
          session_id: sessionId.current,
          total_pnl: metrics.totalPnL,
          daily_pnl: metrics.dailyPnL,
          win_rate: metrics.winRate,
          sharpe_ratio: metrics.sharpeRatio,
          max_drawdown: metrics.maxDrawdown,
          active_positions: metrics.activePositions,
          trades_executed: metrics.tradesExecuted,
          markets_monitored: metrics.marketsMonitored,
          anomaly_score: metrics.anomalyScore,
          extra: { bot_detection_accuracy: metrics.botDetectionAccuracy },
        } as never);
      } catch {
        /* offline / permission — non-fatal */
      }
    };
    const id = setInterval(flush, Math.max(5_000, intervalMs));
    return () => clearInterval(id);
  }, [metrics, isRunning, intervalMs]);

  return sessionId.current;
}
