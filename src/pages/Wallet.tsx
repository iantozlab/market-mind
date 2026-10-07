import { useCallback, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Wallet as WalletIcon, ShieldCheck, ArrowDownToLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  connectInjectedWallet,
  formatUsdc,
  getWalletBalances,
  parseUsdcAmount,
  validateWalletAddress,
  wrapUsdcForPolymarket,
  type InjectedWalletConnection,
} from '@/lib/pusd-onramp';

const POLYGONSCAN = 'https://polygonscan.com/tx/';

const WalletPage = () => {
  const [connection, setConnection] = useState<InjectedWalletConnection | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<{ usdce: bigint; pusd: bigint } | null>(null);
  const [recipientPusd, setRecipientPusd] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalHash, setApprovalHash] = useState<string | null>(null);
  const [wrapHash, setWrapHash] = useState<string | null>(null);

  const refreshBalances = useCallback(async (address: `0x${string}`) => {
    const next = await getWalletBalances(address);
    setBalances(next);
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const next = await connectInjectedWallet();
      setConnection(next);
      setRecipient(next.address);
      await refreshBalances(next.address);
      setRecipientPusd((await getWalletBalances(next.address)).pusd);
      toast.success('Wallet connected on Polygon');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not connect wallet');
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!connection || !balances) return;
    setBusy(true);
    setApprovalHash(null);
    setWrapHash(null);
    try {
      const amountBaseUnits = parseUsdcAmount(amount, balances.usdce);
      const destination = validateWalletAddress(recipient);
      const result = await wrapUsdcForPolymarket(connection, destination, amountBaseUnits, setApprovalHash);
      setWrapHash(result.wrapHash);
      await refreshBalances(connection.address);
      setRecipientPusd((await getWalletBalances(destination)).pusd);
      toast.success(`Wrapped ${amount} USDC.e into pUSD`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Conversion failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2 text-xs font-display uppercase text-muted-foreground">
          <WalletIcon className="h-4 w-4 text-primary" /> Wallet
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-[10px] uppercase text-primary">Account & collateral</p>
            <h1 className="font-display text-2xl font-semibold">Wallet</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Connect a wallet, review compatibility, and move Polygon USDC.e into Polymarket pUSD.
            </p>
          </div>
          <Button onClick={connect} disabled={busy} variant={connection ? 'outline' : 'default'}>
            <WalletIcon className="mr-2 h-4 w-4" />
            {connection ? `${connection.address.slice(0, 6)}...${connection.address.slice(-4)}` : 'Connect wallet'}
          </Button>
        </div>

        <Tabs defaultValue="account" className="space-y-5">
          <TabsList aria-label="Wallet sections">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="fund">Fund account</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Wallet compatibility
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="border-l-2 border-primary pl-3">
                  <h2 className="text-sm font-medium">Deposit Wallet</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Recommended for the bot. Polymarket account wallet with a scoped, revocable Session Key for CLOB trading.</p>
                </div>
                <div className="border-l-2 border-border pl-3">
                  <h2 className="text-sm font-medium">Safe or Proxy Wallet</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Legacy Polymarket smart-wallet accounts. Use the account wallet address as the pUSD recipient.</p>
                </div>
                <div className="border-l-2 border-border pl-3">
                  <h2 className="text-sm font-medium">Connected EOA</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">MetaMask, Rabby, and Coinbase Wallet browser providers can approve funding transactions. Direct EOA trading is interactive and may require Polymarket allowlisting.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30">
              <CardContent className="flex gap-3 p-4">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <div>
                  <h2 className="text-sm font-medium">Funding and bot authorization are separate</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Connecting this wallet lets you approve on-chain funding. It does not change the bot signer or authorize automated orders. Session-Key trading must be configured for the same Deposit Wallet before LIVE mode can safely use these funds.
                  </p>
                  <a className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline" href="https://docs.polymarket.com/trading/session-keys" target="_blank" rel="noreferrer">
                    Polymarket Session Key requirements <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fund" className="grid items-start gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowDownToLine className="h-4 w-4 text-primary" /> Convert USDC.e to pUSD
                </CardTitle>
                <p className="text-xs leading-5 text-muted-foreground">
                  Polygon USDC.e is wrapped 1:1 by Polymarket. The connected wallet pays the USDC.e; pUSD is minted to the recipient below.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-border p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">USDC.e available</p>
                    <p className="mt-1 font-mono text-lg">{balances ? formatUsdc(balances.usdce) : '—'}</p>
                  </div>
                  <div className="border border-border p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">pUSD at recipient</p>
                    <p className="mt-1 font-mono text-lg">{recipientPusd != null ? formatUsdc(recipientPusd) : '—'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pusd-recipient">Polymarket account wallet recipient</Label>
                  <Input id="pusd-recipient" value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="0x..." autoComplete="off" />
                  <p className="text-[11px] text-muted-foreground">Defaults to the connected wallet. For bot funding, enter the Deposit Wallet address shown in your Polymarket account.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="usdce-amount">Amount (USDC.e)</Label>
                  <div className="flex gap-2">
                    <Input id="usdce-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" />
                    <Button type="button" variant="outline" disabled={!balances} onClick={() => setAmount(balances ? formatUsdc(balances.usdce) : '')}>Max</Button>
                  </div>
                </div>

                <Button className="w-full" onClick={convert} disabled={!connection || !balances || busy || !amount || !recipient}>
                  {busy ? 'Waiting for wallet confirmation…' : 'Approve and convert'}
                </Button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  If allowance is missing, your wallet will first ask you to approve exactly this amount for Polymarket’s onramp. After it confirms, it will ask separately to wrap. No unlimited allowance is requested.
                </p>

                {(approvalHash || wrapHash) && (
                  <div className="space-y-2 border-t border-border pt-3 text-xs">
                    {approvalHash && <a className="flex items-center gap-2 text-primary hover:underline" href={`${POLYGONSCAN}${approvalHash}`} target="_blank" rel="noreferrer"><CheckCircle2 className="h-4 w-4" /> Approval confirmed <ExternalLink className="h-3 w-3" /></a>}
                    {wrapHash && <a className="flex items-center gap-2 text-primary hover:underline" href={`${POLYGONSCAN}${wrapHash}`} target="_blank" rel="noreferrer"><CheckCircle2 className="h-4 w-4" /> pUSD wrap confirmed <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Before trading</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-xs leading-5 text-muted-foreground">
                <p>1. Use the exact Deposit Wallet address associated with your Polymarket account as the recipient.</p>
                <p>2. Confirm pUSD arrives at that account on PolygonScan before enabling live trading.</p>
                <p>3. Set up Polymarket’s trading approvals and authorize the bot’s CLOB-only Session Key. Never enter a seed phrase or private key in this app.</p>
                <a className="inline-flex items-center gap-1 text-primary hover:underline" href="https://docs.polymarket.com/trading/wallets-auth#session-keys" target="_blank" rel="noreferrer">
                  Wallet authorization guide <ExternalLink className="h-3 w-3" />
                </a>
                <p className="text-[11px]">This installation also requires a dedicated server-side Session Key and Deposit Wallet address. Never enter a private key here.</p>
                <p className="border-t border-border pt-3">This converter handles USDC.e on Polygon. Native USDC on other networks must be deposited through Polymarket’s supported bridge flow instead.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default WalletPage;