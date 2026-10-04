import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchOrders, type OrderAuditRow } from '@/lib/order-audit';

type Filter = 'all' | 'live' | 'paper';

const TradeHistory: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<OrderAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(null);
    fetchOrders({ mode: filter === 'all' ? undefined : filter, limit: 500 })
      .then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [filter]);

  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground font-mono p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-display tracking-wide text-primary">Trade History</h1>
        <div className="flex gap-2">
          {(['all', 'live', 'paper'] as Filter[]).map(f => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>{f}</Button>
          ))}
          <Button size="sm" variant="ghost" asChild><Link to="/">← Dashboard</Link></Button>
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? <p className="text-muted-foreground text-sm">Loading…</p> : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No orders recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>{['Time', 'Mode', 'Market', 'Side', 'Price', 'Size', 'Status', 'Polymarket response'].map(h =>
                <th key={h} className="text-left p-2 font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2"><Badge variant={r.mode === 'live' ? 'destructive' : 'secondary'}>{r.mode}</Badge></td>
                  <td className="p-2 max-w-[240px]">{r.market_label ?? r.token_id}</td>
                  <td className="p-2">{r.side}</td>
                  <td className="p-2">{r.price}</td>
                  <td className="p-2">{r.size}</td>
                  <td className="p-2">{r.status}{r.http_status != null ? ` (${r.http_status})` : ''}</td>
                  <td className="p-2 max-w-[360px] break-all text-muted-foreground">
                    {r.error_message ?? JSON.stringify(r.polymarket_response)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
};

export default TradeHistory;
