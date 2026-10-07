import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { checkSessionOrderReadiness, placeOrderWithSessionKey } from '@/lib/polyswarm-integrator';
import {
  claimSessionOrderRetry,
  deferSessionOrderRetry,
  dismissQueuedSessionOrder,
  finishSessionOrderRetry,
  getSessionOrderQueue,
  type QueuedSessionOrder,
} from '@/lib/session-order-queue';

const TradeHistory = () => {
  const [orders, setOrders] = useState<QueuedSessionOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoRetry, setAutoRetry] = useState(() => localStorage.getItem('polymarket_auto_retry_confirmed_v1') === 'true');
  const refresh = useCallback(() => setOrders(getSessionOrderQueue()), []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  const retry = useCallback(async (id: string) => {
    const order = claimSessionOrderRetry(id);
    if (!order) {
      toast.error('This order is no longer eligible for retry.');
      refresh();
      return;
    }
    setBusyId(id);
    refresh();
    try {
      const readiness = await checkSessionOrderReadiness(order.request.amount);
      if (!readiness.ready) {
        deferSessionOrderRetry(id, `Waiting for pUSD balance and exchange approvals (${readiness.balance}/${readiness.amount} pUSD).`);
        toast.error('Deposit Wallet is not funded or all exchange approvals are not confirmed yet.');
        return;
      }
      const response = await placeOrderWithSessionKey(order.request, false);
      finishSessionOrderRetry(id, response);
      if (response.success) toast.success(`Order accepted: ${response.orderId ?? response.status ?? 'submitted'}`);
      else toast.error(response.error || 'Retry rejected');
    } catch (error) {
      finishSessionOrderRetry(id, {
        success: false,
        retryable: false,
        ambiguous: true,
        error: error instanceof Error ? error.message : 'Order result is unknown',
      });
      toast.error('Retry result is unknown; it was not queued again. Check Polymarket before placing another order.');
    } finally {
      setBusyId(null);
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (!autoRetry) return;
    const timer = setInterval(() => {
      if (busyId !== null) return;
      const next = getSessionOrderQueue().find(order => order.status === 'retryable' && order.retryCount < 3);
      if (next) void retry(next.id);
    }, 30_000);
    return () => clearInterval(timer);
  }, [autoRetry, busyId, retry]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <Link to="/wallet" className="text-xs text-primary hover:underline">Wallet &amp; approvals</Link>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-7">
          <p className="mb-2 text-[10px] uppercase text-primary">Execution records</p>
          <h1 className="font-display text-2xl font-semibold">Trade History</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review submitted orders and retry confirmed balance or allowance rejections after funding or approvals.</p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Order history <span className="ml-2 font-mono text-xs text-muted-foreground">{orders.length}</span></CardTitle>
            <Button size="sm" variant="ghost" onClick={refresh} aria-label="Refresh retry queue" title="Refresh retry queue"><RefreshCw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-start gap-2 border-b border-border pb-3">
              <Checkbox
                id="auto-retry-orders"
                checked={autoRetry}
                onCheckedChange={checked => {
                  const enabled = checked === true;
                  setAutoRetry(enabled);
                  localStorage.setItem('polymarket_auto_retry_confirmed_v1', String(enabled));
                }}
              />
              <div>
                <Label htmlFor="auto-retry-orders" className="text-xs">Auto-retry confirmed balance/allowance rejections</Label>
                <p className="mt-1 text-[11px] text-muted-foreground">When enabled, retries eligible orders every 30 seconds while this page is open, up to 3 times. Check balances and approvals first.</p>
              </div>
            </div>
            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No order attempts have been recorded in this browser yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {orders.map(order => (
                  <article key={order.id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${order.status === 'retryable' ? 'bg-amber-500' : order.status === 'retrying' ? 'bg-primary animate-pulse' : order.status === 'failed' ? 'bg-destructive' : 'bg-emerald-500'}`} />
                        <h2 className="text-sm font-medium">BUY · {order.request.amount.toFixed(2)} pUSD max</h2>
                        <span className="text-[10px] uppercase text-muted-foreground">{order.status}</span>
                      </div>
                      {order.orderId && <p className="mt-1 font-mono text-[11px] text-muted-foreground">Order {order.orderId}</p>}
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">Asset {order.request.assetId} · max price {order.request.maxPrice}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{order.error}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{new Date(order.createdAt).toLocaleString()} · retries {order.retryCount}/3</p>
                      {order.status === 'retryable' && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600"><TriangleAlert className="h-3 w-3" /> Confirm pUSD balance and approvals before retrying.</p>}
                      {order.status === 'failed' && order.error.toLowerCase().includes('unknown') && <p className="mt-1 text-[11px] text-destructive">Check the Polymarket account before submitting another order; this result may be ambiguous.</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {order.status === 'retryable' ? (
                        <Button size="sm" onClick={() => void retry(order.id)} disabled={busyId !== null}>
                          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry order
                        </Button>
                      ) : null}
                      <Button size="icon" variant="ghost" aria-label="Remove queued order" title="Remove queued order" onClick={() => { dismissQueuedSessionOrder(order.id); refresh(); }} disabled={busyId === order.id}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
              This queue is stored in this browser only. Orders with a timeout or unknown submission result are never automatically resent. A retry uses the same asset and maximum price but submits a new FAK order; any unfilled quantity may be canceled.
            </p>
            <a className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline" href="https://polymarket.com/activity" target="_blank" rel="noreferrer">Review Polymarket activity <ExternalLink className="h-3 w-3" /></a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default TradeHistory;