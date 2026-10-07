import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import {
  approveTrading, connectWallet, getMaxOrderUsd, getWalletStatus, hasWallet, setMaxOrderUsd,
  unlockTradingKeys, walletAddress, type WalletStatus,
} from '@/lib/wallet-trading';

const Row: React.FC<{ ok: boolean; label: string; detail?: string }> = ({ ok, label, detail }) => (
  <div className="flex items-start gap-2">
    {ok ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
    <div><div className="text-foreground">{label}</div>{detail && <div className="text-muted-foreground">{detail}</div>}</div>
  </div>
);

const WalletStatusPanel: React.FC = () => {
  const [st, setSt] = useState<WalletStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cap, setCap] = useState(String(getMaxOrderUsd()));

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr(null);
    try { await fn(); setSt(await getWalletStatus()); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }, []);

  const addr = walletAddress();
  return (
    <section className="rounded border border-border p-4 space-y-3 text-xs font-mono" aria-labelledby="wallet-status-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="wallet-status-h" className="text-sm text-primary">Wallet status</h2>
        {st && <Badge variant={st.ready ? 'secondary' : 'destructive'}>{st.ready ? 'Ready to trade' : 'Not ready'}</Badge>}
      </div>
      {!addr ? (
        <Button size="sm" onClick={() => run('Connecting…', connectWallet)} disabled={!hasWallet() || !!busy}>
          {hasWallet() ? 'Connect wallet' : 'No wallet found — install MetaMask'}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{addr}</Badge>
          <Button size="sm" variant="ghost" onClick={() => run('Checking…', async () => undefined)} disabled={!!busy}>
            <RefreshCw className="h-3 w-3 mr-1" />Check
          </Button>
        </div>
      )}

      {st && (
        <div className="space-y-2">
          <Row ok={st.chainOk} label="On Polygon network" />
          <Row ok={st.gasPol >= 0.05} label={`Network fee balance: ${st.gasPol.toFixed(4)} POL`} detail="Needed only to send approvals." />
          <Row ok={st.collateral > 0} label={`Trading balance: ${st.collateral.toFixed(2)} pUSD`} detail="Polymarket's trading dollar (backed by USDC)." />
          {st.approvals.map(a => (
            <React.Fragment key={a.spender}>
              <Row ok={a.collateral} label={`Buying approved — ${a.name}`} />
              <Row ok={a.shares} label={`Selling approved — ${a.name}`} />
            </React.Fragment>
          ))}
          <Row ok={st.tradingKeys} label="Polymarket trading access unlocked" detail="One free signature; kept only while this page is open." />
          <div className="flex flex-wrap gap-2 pt-1">
            {st.approvals.some(a => !a.collateral || !a.shares) && (
              <Button size="sm" variant="destructive" disabled={!!busy}
                onClick={() => window.confirm('Send approval transactions from your wallet? Each costs a small POL network fee.') &&
                  run('Approving…', () => approveTrading(s => setBusy(s)))}>Approve trading</Button>
            )}
            {!st.tradingKeys && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('Unlocking…', unlockTradingKeys)}>Unlock trading access</Button>}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 pt-1">
        <span className="text-muted-foreground">Bot live mode: max per order ($)</span>
        <input className="h-7 w-20 rounded border border-border bg-background px-2" inputMode="decimal" value={cap}
          onChange={e => setCap(e.target.value)} onBlur={() => { const v = Number(cap); if (v > 0) setMaxOrderUsd(v); setCap(String(getMaxOrderUsd())); }} aria-label="Max dollars per bot order" />
      </label>
      {busy && <div className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{busy}</div>}
      {err && <div className="text-destructive break-all" role="alert">{err}</div>}
    </section>
  );
};

export default WalletStatusPanel;
