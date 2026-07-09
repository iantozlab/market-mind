import { useCallback, useEffect, useRef, useState } from 'react';
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

const BADGE_KEY = 'metrics_last_flush_v1';

export type PersistenceAttemptStatus = 'ok' | 'error' | 'retrying';
export interface PersistenceAttempt {
  ts: number;
  status: PersistenceAttemptStatus;
  count: number;
  message?: string;
}

export interface LastFlushBadge {
  status: PersistenceAttemptStatus;
  ts: number;
  count: number;
  retries: number;
  message?: string;
}

function loadBadge(): LastFlushBadge | null {
  try { return JSON.parse(localStorage.getItem(BADGE_KEY) || 'null'); } catch { return null; }
}
function saveBadge(b: LastFlushBadge | null) {
  try {
    if (b) localStorage.setItem(BADGE_KEY, JSON.stringify(b));
    else localStorage.removeItem(BADGE_KEY);
  } catch { /* noop */ }
}

export interface MetricsPersistenceStatus {
  sessionId: string;
  lastSavedAt: number | null;
  lastError: string | null;
  queueDepth: number;
  isFlushing: boolean;
  isReplaying: boolean;
  attempts: PersistenceAttempt[];
  lastFlush: LastFlushBadge | null;
  retryCount: number;
  flushNow: () => Promise<void>;
  clearAttempts: () => void;
}

const MAX_ATTEMPTS = 20;
const TOAST_DEDUPE_MS = 15_000;

export function useMetricsPersistence(
  metrics: BotMetrics,
  isRunning: boolean,
  intervalMs: number = 30_000,
): MetricsPersistenceStatus {
  const [status, setStatus] = useState<Omit<MetricsPersistenceStatus, 'flushNow' | 'clearAttempts'>>(() => {
    const badge = loadBadge();
    return {
      sessionId: getSessionId(),
      lastSavedAt: badge?.status === 'ok' ? badge.ts : null,
      lastError: badge?.status === 'error' ? badge.message ?? null : null,
      queueDepth: loadQueue().length,
      isFlushing: false,
      isReplaying: false,
      attempts: [],
      lastFlush: badge,
      retryCount: badge?.retries ?? 0,
    };
  });

  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const sessionIdRef = useRef(status.sessionId);
  const lastSent = useRef(0);
  const backoff = useRef(0);
  const wasFailing = useRef(loadQueue().length > 0);
  const lastToastKey = useRef<string>('');
  const lastToastAt = useRef(0);
  const inFlight = useRef(false);
  const retriesRef = useRef<number>(status.retryCount);

  const pushAttempt = useCallback((a: PersistenceAttempt) => {
    setStatus(s => ({ ...s, attempts: [a, ...s.attempts].slice(0, MAX_ATTEMPTS) }));
  }, []);

  const showToast = useCallback((key: string, fn: () => void) => {
    const now = Date.now();
    if (lastToastKey.current === key && now - lastToastAt.current < TOAST_DEDUPE_MS) return;
    lastToastKey.current = key;
    lastToastAt.current = now;
    fn();
  }, []);

  const flush = useCallback(async (opts: { manual?: boolean } = {}) => {
    if (inFlight.current) return;
    if (!opts.manual) {
      if (Date.now() - lastSent.current < intervalMs) return;
      if (Date.now() < backoff.current) return;
    }
    lastSent.current = Date.now();
    inFlight.current = true;

    const m = metricsRef.current;
    const row = {
      session_id: sessionIdRef.current,
      total_pnl: m.totalPnL,
      daily_pnl: m.dailyPnL,
      win_rate: m.winRate,
      sharpe_ratio: m.sharpeRatio,
      max_drawdown: m.maxDrawdown,
      active_positions: m.activePositions,
      trades_executed: m.tradesExecuted,
      markets_monitored: m.marketsMonitored,
      anomaly_score: m.anomalyScore,
      extra: { bot_detection_accuracy: m.botDetectionAccuracy, queued_at: Date.now() },
    };

    const queue = loadQueue();
    const isReplay = queue.length > 0;
    queue.push(row);
    setStatus(s => ({ ...s, isFlushing: true, isReplaying: isReplay, queueDepth: queue.length }));

    try {
      if (wasFailing.current || opts.manual) {
        pushAttempt({ ts: Date.now(), status: 'retrying', count: queue.length });
        showToast('retry', () =>
          toast.loading(opts.manual ? 'Flushing metrics buffer…' : 'Retrying metrics sync…', { id: 'metrics-persist' }),
        );
      }
      // Queue is FIFO (push appends, insert preserves array order) — replayed in order.
      const { error } = await supabase.from('metrics_snapshots' as never).insert(queue as never);
      if (error) throw error;
      saveQueue([]);
      backoff.current = 0;
      pushAttempt({ ts: Date.now(), status: 'ok', count: queue.length });
      if (wasFailing.current || opts.manual) {
        showToast('ok', () =>
          toast.success(`Metrics sync ok · flushed ${queue.length}`, { id: 'metrics-persist' }),
        );
      }
      wasFailing.current = false;
      retriesRef.current = 0;
      const badge: LastFlushBadge = { status: 'ok', ts: Date.now(), count: queue.length, retries: 0 };
      saveBadge(badge);
      setStatus(s => ({
        ...s, lastSavedAt: Date.now(), lastError: null, queueDepth: 0,
        isFlushing: false, isReplaying: false, lastFlush: badge, retryCount: 0,
      }));
    } catch (e) {
      saveQueue(queue);
      const delay = Math.min(300_000, 5_000 * Math.pow(2, Math.min(6, Math.floor(queue.length / 3))));
      backoff.current = Date.now() + delay;
      const msg = e instanceof Error ? e.message : String(e);
      retriesRef.current += 1;
      pushAttempt({ ts: Date.now(), status: 'error', count: queue.length, message: msg });
      showToast('err', () =>
        toast.error(`Metrics sync failed · buffering (${queue.length})`, {
          id: 'metrics-persist',
          description: msg.slice(0, 120),
        }),
      );
      wasFailing.current = true;
      const badge: LastFlushBadge = { status: 'error', ts: Date.now(), count: queue.length, retries: retriesRef.current, message: msg };
      saveBadge(badge);
      setStatus(s => ({
        ...s, lastError: msg, queueDepth: queue.length,
        isFlushing: false, isReplaying: false, lastFlush: badge, retryCount: retriesRef.current,
      }));
    } finally {
      inFlight.current = false;
    }
  }, [intervalMs, pushAttempt, showToast]);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => { void flush(); }, Math.max(5_000, intervalMs));
    return () => clearInterval(id);
  }, [isRunning, intervalMs, flush]);

  const flushNow = useCallback(async () => {
    backoff.current = 0;
    await flush({ manual: true });
  }, [flush]);

  const clearAttempts = useCallback(() => {
    setStatus(s => ({ ...s, attempts: [] }));
  }, []);

  // Auto-flush pending writes on network reconnect
  useEffect(() => {
    const onOnline = () => {
      const q = loadQueue();
      if (q.length > 0 || wasFailing.current) {
        showToast('online', () => toast.message('Network reconnected · flushing metrics buffer', { id: 'metrics-persist' }));
        backoff.current = 0;
        void flush({ manual: true });
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush, showToast]);

  return { ...status, flushNow, clearAttempts };
}

