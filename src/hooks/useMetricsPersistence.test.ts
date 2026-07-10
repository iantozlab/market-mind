import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the supabase client BEFORE importing the hook.
const insertMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ insert: insertMock }),
  },
}));

// Silence toast side effects
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: () => {}, error: () => {}, loading: () => {}, message: () => {},
  }),
}));

import { useMetricsPersistence } from '@/hooks/useMetricsPersistence';
import type { BotMetrics } from '@/lib/neural-bot-engine';

const baseMetrics = (): BotMetrics => ({
  totalPnL: 0, dailyPnL: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0,
  activePositions: 0, tradesExecuted: 0, marketsMonitored: 0, anomalyScore: 0,
  botDetectionAccuracy: 0,
}) as unknown as BotMetrics;

describe('useMetricsPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    insertMock.mockReset();
  });

  it('replays queued writes in FIFO order after a failure then success', async () => {
    // First 3 attempts fail; each pushes another row into the queue.
    insertMock
      .mockResolvedValueOnce({ error: new Error('net down') })
      .mockResolvedValueOnce({ error: new Error('net down') })
      .mockResolvedValueOnce({ error: new Error('net down') })
      .mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() =>
      useMetricsPersistence(baseMetrics(), false, 30_000),
    );

    for (let i = 0; i < 4; i++) {
      // Small artificial spacing so queued_at values are strictly increasing.
      await act(async () => { await result.current.flushNow(); });
      await new Promise(r => setTimeout(r, 2));
    }

    // 4 insert calls, last one succeeds with all 4 rows in FIFO order.
    expect(insertMock).toHaveBeenCalledTimes(4);
    const finalCallRows = insertMock.mock.calls[3][0] as Array<{ extra: { queued_at: number } }>;
    expect(finalCallRows).toHaveLength(4);
    const queuedAts = finalCallRows.map(r => r.extra.queued_at);
    const sorted = [...queuedAts].sort((a, b) => a - b);
    expect(queuedAts).toEqual(sorted);

    await waitFor(() => expect(result.current.queueDepth).toBe(0));
    expect(result.current.pendingQueue).toEqual([]);
  });

  it('persists retryCount and lastFlush badge until the next successful write', async () => {
    insertMock
      .mockResolvedValueOnce({ error: new Error('boom') })
      .mockResolvedValueOnce({ error: new Error('boom') });

    const { result, unmount } = renderHook(() =>
      useMetricsPersistence(baseMetrics(), false, 30_000),
    );

    await act(async () => { await result.current.flushNow(); });
    await act(async () => { await result.current.flushNow(); });

    const badgeRaw = localStorage.getItem('metrics_last_flush_v1');
    expect(badgeRaw).toBeTruthy();
    const badge = JSON.parse(badgeRaw as string);
    expect(badge.status).toBe('error');
    expect(badge.retries).toBeGreaterThanOrEqual(2);
    expect(result.current.retryCount).toBeGreaterThanOrEqual(2);

    // Simulate reload: unmount + remount, badge must still be restored.
    unmount();
    const { result: result2 } = renderHook(() =>
      useMetricsPersistence(baseMetrics(), false, 30_000),
    );
    expect(result2.current.lastFlush?.status).toBe('error');
    expect(result2.current.retryCount).toBeGreaterThanOrEqual(2);

    // Next successful write clears retryCount and flips badge to ok.
    insertMock.mockResolvedValueOnce({ error: null });
    await act(async () => { await result2.current.flushNow(); });

    await waitFor(() => expect(result2.current.lastFlush?.status).toBe('ok'));
    expect(result2.current.retryCount).toBe(0);
    const badge2 = JSON.parse(localStorage.getItem('metrics_last_flush_v1') as string);
    expect(badge2.status).toBe('ok');
    expect(badge2.retries).toBe(0);
  });
});
