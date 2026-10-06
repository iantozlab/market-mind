import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { getFills, walletAddress, type Fill } from '@/lib/wallet-trading';

/** Trades that actually matched on Polymarket for the connected wallet. Refreshes every 15s. */
const FillsPanel: React.FC = () => {
  const [fills, setFills] = useState<Fill[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    if (!walletAddress()) { setErr('Connect your wallet above to see fills.'); return; }
    setLoading(true); setErr(null);
    try { setFills(await getFills()); setAuto(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(id);
  }, [auto, load]);

  return (
    <section className="rounded border border-border p-4 space-y-3 text-xs font-mono" aria-labelledby="fills-h">
      <div className="flex items-center justify-between">
        <h2 id="fills-h" className="text-sm text-primary">Fills {auto && <span className="text-muted-foreground">· live, every 15s</span>}</h2>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}{auto ? 'Refresh' : 'Load fills'}
        </Button>
      </div>
      {err && <p className="text-destructive" role="alert">{err}</p>}
      {auto && fills.length === 0 && !err && <p className="text-muted-foreground">No filled orders yet.</p>}
      {fills.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-muted-foreground"><tr>
              <th className="py-1 pr-3">Time</th><th className="pr-3">Side</th><th className="pr-3">Outcome</th>
              <th className="pr-3">Price</th><th className="pr-3">Size</th><th className="pr-3">Status</th><th>Tx</th>
            </tr></thead>
            <tbody>
              {fills.map(f => (
                <tr key={f.id} className="border-t border-border">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(f.time).toLocaleString()}</td>
                  <td className="pr-3">{f.side}</td><td className="pr-3">{f.outcome}</td>
                  <td className="pr-3">{f.price}</td><td className="pr-3">{f.size}</td><td className="pr-3">{f.status}</td>
                  <td>{f.tx ? <a className="text-primary underline" href={`https://polygonscan.com/tx/${f.tx}`} target="_blank" rel="noreferrer">{f.tx.slice(0, 10)}…</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default FillsPanel;
