import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchOrders, placeLiveOrder, type OrderAuditRow } from '@/lib/order-audit';

interface Analysis { likely_cause: string; safe_next_step: string; retry_safe: boolean; confidence: string }

const statusVariant = (s: string) =>
  s === 'rejected' || s === 'error' || s === 'invalid' ? 'destructive' : s === 'pending' ? 'outline' : 'secondary';

const OrderCard: React.FC<{ o: OrderAuditRow; onRetried: () => void }> = ({ o, onRetried }) => {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const failed = ['rejected', 'error', 'invalid'].includes(o.status);

  const explain = async () => {
    setExplaining(true); setErr(null);
    const { data, error } = await supabase.functions.invoke('explain-order-rejection', {
      body: {
        message: o.error_message ?? JSON.stringify(o.polymarket_response),
        details: `${o.side} ${o.size} shares @ ${o.price}, ${o.order_type}, HTTP ${o.http_status ?? 'n/a'}, signatureType 0 (EOA), market: ${o.market_label ?? o.token_id}`,
      },
    });
    setExplaining(false);
    if (error || data?.error) { setErr(data?.error ?? error?.message ?? 'Explainer failed'); return; }
    setAnalysis(data.analysis);
  };

  const retry = async () => {
    if (!o.token_id) return;
    if (!window.confirm(`Re-send this REAL order?\n${o.side} ${o.size} @ ${o.price}\nThis uses real money if it fills.`)) return;
    setRetrying(true); setErr(null);
    try {
      await placeLiveOrder({ tokenId: o.token_id, side: o.side, price: o.price, size: o.size, orderType: o.order_type, marketLabel: o.market_label ?? undefined, retryOf: o.id });
      onRetried();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Retry failed'); }
    finally { setRetrying(false); }
  };

  return (
    <div className="rounded border border-border p-3 space-y-2 text-xs font-mono">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
        {o.http_status != null && <Badge variant="outline">HTTP {o.http_status}</Badge>}
        <span className="text-muted-foreground">{new Date(o.created_at).toLocaleString()}</span>
        {o.retry_of && <Badge variant="outline">retry</Badge>}
      </div>
      <div className="text-foreground">{o.market_label ?? o.token_id}</div>
      <div className="text-muted-foreground">{o.side} {o.size} @ {o.price} · {o.order_type}{o.order_id ? ` · id ${o.order_id.slice(0, 12)}…` : ''}</div>
      <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">{JSON.stringify(o.polymarket_response, null, 2)}</pre>
      {failed && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={explain} disabled={explaining}>
            {explaining && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Explain
          </Button>
          <Button size="sm" variant="destructive" onClick={retry}
            disabled={retrying || !o.token_id || (analysis !== null && !analysis.retry_safe)}>
            {retrying && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Retry live
          </Button>
        </div>
      )}
      {analysis && (
        <div className="rounded border border-border p-2 space-y-1">
          <div className="text-primary">{analysis.likely_cause} <span className="text-muted-foreground">({analysis.confidence})</span></div>
          <div>{analysis.safe_next_step}</div>
          <div className={analysis.retry_safe ? 'text-muted-foreground' : 'text-destructive'}>
            {analysis.retry_safe ? 'Retry is OK once the cause is fixed.' : 'Not safe to retry yet — retry is disabled.'}
          </div>
        </div>
      )}
      {err && <div className="text-destructive">{err}</div>}
    </div>
  );
};

const LiveOrdersPanel: React.FC = () => {
  const [orders, setOrders] = useState<OrderAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setOrders(await fetchOrders({ mode: 'live', limit: 50 })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load orders'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">{orders.length} live order(s)</span>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}><RefreshCw className="h-3 w-3 mr-1" />Refresh</Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {!loading && orders.length === 0 && <p className="text-xs text-muted-foreground">No live orders yet.</p>}
      {orders.map(o => <OrderCard key={o.id} o={o} onRetried={load} />)}
    </div>
  );
};

export default LiveOrdersPanel;
