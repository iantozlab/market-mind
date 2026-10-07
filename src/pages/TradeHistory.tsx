import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { fetchOrders, type OrderAuditRow } from '@/lib/order-audit';
import { checkSessionOrderReadiness, placeOrderWithSessionKey } from '@/lib/polyswarm-integrator';
import {
  claimSessionOrderRetry,
  deferSessionOrderRetry,
  dismissQueuedSessionOrder,
  finishSessionOrderRetry,
  getSessionOrderQueue,
  type QueuedSessionOrder,
} from '@/lib/session-order-queue';

type Filter = 'all' | 'live' | 'paper';

const TradeHistory = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<OrderAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryOrders, setRetryOrders] = useState<QueuedSessionOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoRetry, setAutoRetry] = useState(() => localStorage.getItem('polymarket_auto_retry_confirmed_v1') === 'true');

  const refresh = useCallback(() => setRetryOrders(getSessionOrderQueue()), []);
  const loadAudit = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchOrders({ mode: filter === 'all' ? undefined : filter, limit: 500 })
      .then(setRows)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    loadAudit();
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [loadAudit, refresh]);

  const retry = useCallback(async (id: string) => {
    const queued = claimSessionOrderRetry(id);
    if (!queued) {
      toast.error('This order is no longer eligible for retry.');
      refresh();
      return;
    }
    setBusyId(id);
    refresh();
    try {
      const readiness = await checkSessionOrderReadiness(queued.request.amount);
      if (!readiness.ready) {
        deferSessionOrderRetry(id, `Waiting for pUSD balance and exchange approvals (${readiness.balance}/${readiness.amount} pUSD).`);
        toast.error('Deposit Wallet is not funded or all exchange approvals are not confirmed yet.');
        return;
      }
      const response = await placeOrderWithSessionKey(queued.request, false);
      finishSessionOrderRetry(id, response);
      if (response.success) toast.success(`Order accepted: ${response.orderId ?? response.status ?? 'submitted'}`);
      else toast.error(response.error || 'Retry rejected');
      loadAudit();
    } catch (retryError) {
      finishSessionOrderRetry(id, {
        success: false,
        retryable: false,
        ambiguous: true,
        error: retryError instanceof Error ? retryError.message : 'Order result is unknown',
      });
      toast.error('Retry result is unknown; it was not queued again. Check Polymarket before placing another order.');
    } finally {
      setBusyId(null);
      refresh();
    }
  }, [loadAudit, refresh]);

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
    <main id="main-content" className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase text-primary">Execution records</p>
            <h1 className="font-display text-2xl font-semibold">Trade History</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/wallet" className="text-xs text-primary hover:underline">Wallet funding</Link>
            <Link to="/wallet-guide" className="text-xs text-primary hover:underline">EOA wallet guide</Link>
            <Button size="sm" variant="ghost" asChild><Link to="/"><ArrowLeft className="mr-1 h-4 w-4" /> Dashboard</Link></Button>
          </div>
        </header>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Session Key retry queue <span className="ml-2 font-mono text-xs text-muted-foreground">{retryOrders.length}</span></CardTitle>
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
                <p className="mt-1 text-[11px] text-muted-foreground">Retries eligible Session Key orders every 30 seconds while this page is open, up to 3 times. Readiness is checked first.</p>
              </div>
            </div>
            {retryOrders.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">No Session Key order attempts recorded in this browser.</p>
            ) : (
              <div className="divide-y divide-border">
                {retryOrders.map(order => (
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
                      {order.status === 'failed' && order.error.toLowerCase().includes('unknown') && <p className="mt-1 text-[11px] text-destructive">Check Polymarket before submitting another order; this result may be ambiguous.</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {order.status === 'retryable' && <Button size="sm" onClick={() => void retry(order.id)} disabled={busyId !== null}><RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry order</Button>}
                      <Button size="icon" variant="ghost" aria-label="Remove queued order" title="Remove queued order" onClick={() => { dismissQueuedSessionOrder(order.id); refresh(); }} disabled={busyId === order.id}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">Retry history is stored in this browser. Unknown submission outcomes are never resent. Session Key FAK retries use a new order; unfilled quantity may be canceled.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Persisted orders and fills</CardTitle>
            <div className="flex gap-2">
              {(['all', 'live', 'paper'] as Filter[]).map(value => <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{value}</Button>)}
              <Button size="icon" variant="ghost" onClick={loadAudit} aria-label="Refresh persisted orders" title="Refresh persisted orders"><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            {loading ? <p className="py-6 text-sm text-muted-foreground">Loading order records…</p> : rows.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No persisted orders recorded yet.</p>
            ) : (
              <div className="overflow-x-auto border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted text-muted-foreground"><tr>{['Time', 'Mode', 'Market', 'Side', 'Price', 'Size', 'Status', 'Polymarket response'].map(label => <th key={label} className="p-2 text-left font-normal">{label}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(row => <tr key={row.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap p-2">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="p-2"><Badge variant={row.mode === 'live' ? 'destructive' : 'secondary'}>{row.mode}</Badge></td>
                      <td className="max-w-[240px] p-2">{row.market_label ?? row.token_id}</td>
                      <td className="p-2">{row.side}</td>
                      <td className="p-2">{row.price}</td>
                      <td className="p-2">{row.size}</td>
                      <td className="p-2">{row.status}{row.http_status != null ? ` (${row.http_status})` : ''}</td>
                      <td className="max-w-[360px] break-all p-2 text-muted-foreground">{row.error_message ?? JSON.stringify(row.polymarket_response)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            )}
            <a className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline" href="https://polymarket.com/activity" target="_blank" rel="noreferrer">Review Polymarket activity <ExternalLink className="h-3 w-3" /></a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default TradeHistory;