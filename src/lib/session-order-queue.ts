import type { SessionOrderRequest, SessionOrderResponse } from './polyswarm-integrator';

const STORAGE_KEY = 'polymarket_session_order_retry_queue_v1';
const MAX_QUEUE = 100;
const MAX_RETRIES = 3;

export interface QueuedSessionOrder {
  id: string;
  createdAt: number;
  request: SessionOrderRequest;
  error: string;
  status: 'retryable' | 'retrying' | 'failed' | 'accepted' | 'matched' | 'delayed';
  retryCount: number;
  orderId?: string;
  tradeIds?: string[];
  lastAttemptAt?: number;
}

function readQueue(): QueuedSessionOrder[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is QueuedSessionOrder =>
      item && typeof item.id === 'string' && item.request &&
      typeof item.request.assetId === 'string' && Number.isFinite(item.request.amount) &&
      Number.isFinite(item.request.maxPrice));
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSessionOrder[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE))); } catch { /* queue remains session-local */ }
}

export function getSessionOrderQueue(): QueuedSessionOrder[] {
  return readQueue().sort((a, b) => b.createdAt - a.createdAt);
}

export function recordSessionOrderAttempt(request: SessionOrderRequest, response: SessionOrderResponse): QueuedSessionOrder {
  const queue = readQueue();
  const retryable = !response.success && response.retryable && !response.ambiguous;
  const orderStatus = response.success
    ? response.status === 'matched' ? 'matched' : response.status === 'delayed' ? 'delayed' : 'accepted'
    : retryable ? 'retryable' : 'failed';
  const item: QueuedSessionOrder = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    request,
    error: response.error || '',
    status: orderStatus,
    retryCount: 0,
    orderId: response.orderId,
  };
  queue.unshift(item);
  writeQueue(queue);
  return item;
}

export function claimSessionOrderRetry(id: string): QueuedSessionOrder | null {
  const queue = readQueue();
  const index = queue.findIndex(item => item.id === id);
  if (index < 0 || queue[index].status !== 'retryable' || queue[index].retryCount >= MAX_RETRIES) return null;
  const claimed = { ...queue[index], status: 'retrying' as const, lastAttemptAt: Date.now() };
  queue[index] = claimed;
  writeQueue(queue);
  return claimed;
}

export function finishSessionOrderRetry(id: string, response: SessionOrderResponse) {
  const queue = readQueue();
  const index = queue.findIndex(item => item.id === id);
  if (index < 0) return;
  if (response.success) {
    queue[index] = {
      ...queue[index],
      status: response.status === 'matched' ? 'matched' : response.status === 'delayed' ? 'delayed' : 'accepted',
      orderId: response.orderId,
      tradeIds: response.tradeIds,
      error: '',
      retryCount: queue[index].retryCount + 1,
    };
  } else {
    const retryCount = queue[index].retryCount + 1;
    queue[index] = {
      ...queue[index],
      error: response.error || 'Retry failed',
      status: response.retryable && !response.ambiguous && retryCount < MAX_RETRIES ? 'retryable' : 'failed',
      retryCount,
    };
  }
  writeQueue(queue);
}

export function deferSessionOrderRetry(id: string, reason: string) {
  const queue = readQueue();
  const index = queue.findIndex(item => item.id === id);
  if (index < 0) return;
  queue[index] = { ...queue[index], status: 'retryable', error: reason };
  writeQueue(queue);
}

export function dismissQueuedSessionOrder(id: string) {
  writeQueue(readQueue().filter(item => item.id !== id));
}

export function clearSessionOrderQueue() { writeQueue([]); }