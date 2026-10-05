import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchOrders, placeLiveOrder, type OrderAuditRow } from '@/lib/order-audit';
import { connectWallet, hasWallet, placeWalletOrder, walletAddress } from '@/lib/wallet-trading';

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
      const viaWallet = (o.polymarket_response as { source?: string } | null)?.source === 'browser_wallet';
      const args = { tokenId: o.token_id, side: o.side as 'BUY' | 'SELL', price: o.price, size: o.size, orderType: o.order_type as 'GTC' | 'FAK' | 'FOK', marketLabel: o.market_label ?? undefined, retryOf: o.id };
      if (viaWallet) await placeWalletOrder(args); else await placeLiveOrder(args);
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

const WalletOrderForm: React.FC<{ onPlaced: () => void }> = ({ onPlaced }) => {
  const [addr, setAddr] = useState<string | null>(walletAddress());
  const [f, setF] = useState({ tokenId: '', marketLabel: '', side: 'BUY', price: '', size: '', orderType: 'GTC' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const connect = async () => {
    setMsg(null);
    try { setAddr(await connectWallet()); } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not connect wallet'); }
  };
  const submit = async () => {
    const price = Number(f.price), size = Number(f.size);
    if (!/^\d{1,90}$/.test(f.tokenId) || !(price > 0 && price < 1) || !(size > 0 && size <= 10000)) {
      setMsg('Enter a valid token ID, a price between 0 and 1, and a size above 0.'); return;
    }
    if (!window.confirm(`Send this REAL order from your wallet?\n${f.side} ${size} @ ${price} (≈ $${(size * price).toFixed(2)})\nUses real money if it fills.`)) return;
    setBusy(true); setMsg(null);
    try {
      const row = await placeWalletOrder({ tokenId: f.tokenId, side: f.side as 'BUY' | 'SELL', price, size, orderType: f.orderType as 'GTC' | 'FAK' | 'FOK', marketLabel: f.marketLabel || undefined });
      setMsg(`Polymarket replied: ${row.status}${row.error_message ? ` — ${row.error_message}` : ''}`);
      onPlaced();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Order failed'); }
    finally { setBusy(false); }
  };
  const input = 'h-8 rounded border border-border bg-background px-2 text-xs font-mono';

  return (
    <div className="rounded border border-primary/40 p-3 space-y-2 text-xs font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-primary">Send from my wallet</span>
        {addr ? <Badge variant="outline">{addr.slice(0, 6)}…{addr.slice(-4)}</Badge>
          : <Button size="sm" variant="outline" onClick={connect} disabled={!hasWallet()}>{hasWallet() ? 'Connect wallet' : 'No wallet found'}</Button>}
      </div>
      <p className="text-muted-foreground">Signed in your wallet and sent from your own internet connection. The wallet needs USDC on Polygon and trading approval on Polymarket.</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={`${input} col-span-2`} placeholder="Token ID (outcome)" value={f.tokenId} onChange={set('tokenId')} aria-label="Token ID" />
        <input className={`${input} col-span-2`} placeholder="Market name (optional)" value={f.marketLabel} onChange={set('marketLabel')} aria-label="Market name" />
        <select className={input} value={f.side} onChange={set('side')} aria-label="Side"><option>BUY</option><option>SELL</option></select>
        <select className={input} value={f.orderType} onChange={set('orderType')} aria-label="Order type"><option>GTC</option><option>FAK</option><option>FOK</option></select>
        <input className={input} placeholder="Price (e.g. 0.55)" value={f.price} onChange={set('price')} aria-label="Price" inputMode="decimal" />
        <input className={input} placeholder="Shares (e.g. 5)" value={f.size} onChange={set('size')} aria-label="Shares" inputMode="decimal" />
      </div>
      <Button size="sm" variant="destructive" onClick={submit} disabled={busy || !addr}>
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Sign & send real order
      </Button>
      {msg && <div className="text-muted-foreground break-all">{msg}</div>}
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
      <WalletOrderForm onPlaced={load} />
      {error && <p className="text-destructive text-xs">{error}</p>}
      {!loading && orders.length === 0 && <p className="text-xs text-muted-foreground">No live orders yet.</p>}
      {orders.map(o => <OrderCard key={o.id} o={o} onRetried={load} />)}
    </div>
  );
};

export default LiveOrdersPanel;
