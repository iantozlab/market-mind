import React from 'react';
import WalletStatusPanel from '@/components/WalletStatusPanel';
import FillsPanel from '@/components/FillsPanel';

const steps: { title: string; body: React.ReactNode }[] = [
  { title: 'Install a browser wallet', body: <>Install MetaMask (or Rabby) in this browser and create a wallet. Write the recovery phrase down offline — never paste it anywhere.</> },
  { title: 'Check Polymarket is allowed where you are', body: <>Open polymarket.com from your own connection and confirm trading isn't restricted in your country. This app sends orders from your connection, so Polymarket's rules for your location apply.</> },
  { title: 'Create your Polymarket account', body: <>On polymarket.com, sign in with the same wallet. That links the wallet to Polymarket. Note: this app trades directly from the wallet itself, not from the Polymarket deposit wallet the website may create — keep funds you want the bot to use in this wallet.</> },
  { title: 'Add network fees (POL)', body: <>Send about 1 POL to the wallet on the Polygon network. It pays the small fees for the approval step below.</> },
  { title: 'Get the trading balance (pUSD)', body: <>Polymarket's exchange settles in pUSD, its dollar token backed by USDC. Fund the wallet with pUSD on Polygon (for example by depositing USDC through Polymarket and withdrawing to this wallet). The status panel shows your pUSD balance.</> },
  { title: 'Approve trading', body: <>Connect the wallet below and click <b>Approve trading</b>. This lets Polymarket's two exchanges move your pUSD when you buy and your shares when you sell. Each approval is one wallet transaction.</> },
  { title: 'Unlock trading access', body: <>Click <b>Unlock trading access</b> and sign once (free). Polymarket then accepts orders from this wallet during this session.</> },
  { title: 'Test, then go live', body: <>Place one small order from <b>Defense → Send from my wallet</b>. When it works, switch the bot's <b>Mode</b> to LIVE. Each bot order is capped by your max per order and your wallet asks you to approve it.</> },
];

const WalletGuide: React.FC = () => (
  <main id="main" className="min-h-screen bg-background text-foreground p-4 md:p-8">
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-mono text-primary">Wallet setup guide</h1>
        <a href="/" className="text-xs font-mono text-muted-foreground hover:text-primary">← Dashboard</a>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded border border-border p-3 text-xs font-mono">
            <div className="text-primary">{i + 1}. {s.title}</div>
            <p className="mt-1 text-muted-foreground leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
      <WalletStatusPanel />
      <FillsPanel />
    </div>
  </main>
);

export default WalletGuide;
