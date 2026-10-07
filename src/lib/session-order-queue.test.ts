import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimSessionOrderRetry,
  finishSessionOrderRetry,
  getSessionOrderQueue,
  recordSessionOrderAttempt,
} from './session-order-queue';

const request = { assetId: '123456789', amount: 10, maxPrice: 0.55 };

describe('session order retry queue', () => {
  beforeEach(() => localStorage.clear());

  it('queues only confirmed retryable rejections', () => {
    recordSessionOrderAttempt(request, { success: false, retryable: true, ambiguous: false, error: 'not enough balance / allowance' });
    recordSessionOrderAttempt(request, { success: false, retryable: false, ambiguous: true, error: 'timeout' });
    expect(getSessionOrderQueue()).toHaveLength(2);
    expect(getSessionOrderQueue().filter(item => item.status === 'retryable')).toHaveLength(1);
  });

  it('claims once and keeps a successful retry in order history', () => {
    const item = recordSessionOrderAttempt(request, { success: false, retryable: true, ambiguous: false });
    expect(claimSessionOrderRetry(item.id)?.status).toBe('retrying');
    expect(claimSessionOrderRetry(item.id)).toBeNull();
    finishSessionOrderRetry(item.id, { success: true, retryable: false, orderId: 'order-1' });
    expect(getSessionOrderQueue()).toMatchObject([{ id: item.id, status: 'accepted', orderId: 'order-1', retryCount: 1 }]);
  });
});