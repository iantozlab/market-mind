import React, { useEffect, useState } from 'react';
import { Shield, ShieldAlert, Lock, KeyRound, Download, Trash2, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { nonceDefender, DEFENSE_PARAMS } from '@/lib/nonce-race-defender';

const modeColor: Record<string, string> = {
  PASSIVE: 'text-muted-foreground border-border',
  ACTIVE: 'text-primary border-primary/40 bg-primary/10',
  AGGRESSIVE: 'text-destructive border-destructive/40 bg-destructive/10',
};

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <Card className="p-2.5">
    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={`font-mono text-sm mt-0.5 ${tone ?? 'text-foreground'}`}>{value}</div>
  </Card>
);

const ago = (t: number) => {
  if (!t) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const DefensePanel: React.FC = () => {
  const [, force] = useState(0);
  useEffect(() => nonceDefender.subscribe(() => force(n => n + 1)), []);
  useEffect(() => {
    const i = setInterval(() => force(n => n + 1), 5000);
    return () => clearInterval(i);
  }, []);

  const status = nonceDefender.getStatus();
  const attacks = nonceDefender.getAttacks();
  const manipulations = nonceDefender.getManipulations();
  const log = nonceDefender.getLog();
  const blacklist = nonceDefender.getBlacklist();
  const opportunities = nonceDefender.getOpportunities();
  const patches = nonceDefender.getPatches();

  const exportCsv = () => {
    const blob = new Blob([nonceDefender.toCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `defense-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {status.defenseMode === 'AGGRESSIVE'
              ? <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
              : <Shield className="h-4 w-4 text-primary" aria-hidden />}
            <span className="font-display text-sm tracking-wide">Nonce Race Defender</span>
            <span className={`text-[9px] uppercase tracking-widest border rounded px-1.5 py-0.5 ${modeColor[status.defenseMode]}`}>
              {status.defenseMode}
            </span>
          </div>
          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
            Armed
            <Switch
              checked={status.defenseActive}
              onCheckedChange={v => nonceDefender.setDefenseActive(v)}
              aria-label="Toggle defense engine"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Attacks" value={String(attacks.length)} tone={attacks.length ? 'text-destructive' : undefined} />
          <Stat label="Blacklisted" value={String(status.blacklistedAddresses)} />
          <Stat label="Blocked orders" value={`${status.ordersBlocked}/${status.ordersScreened}`} />
          <Stat label="Counter P&L" value={`$${status.counterExploitProfit.toFixed(2)}`} tone="text-primary" />
          <Stat label="Manipulation" value={String(manipulations.length)} tone={manipulations.length ? 'text-warning' : undefined} />
          <Stat label="Ticks screened" value={String(status.ticksProcessed)} />
          <Stat label="Last attack" value={ago(status.lastAttackTime)} />
          <Stat label="Key rotated" value={ago(status.lastKeyRotation)} />
          <Stat label="Mempool mode" value={status.mempoolMode.toUpperCase()} tone={status.mempoolMode === 'private' ? 'text-primary' : undefined} />
          <Stat label="Patches applied" value={String(status.patchesApplied)} tone={status.patchesApplied ? 'text-info' : undefined} />
          <Stat label="Opportunities" value={String(opportunities.length)} tone={opportunities.length ? 'text-primary' : undefined} />
        </div>


        <div className="grid sm:grid-cols-2 gap-2">
          <div className="flex items-center justify-between rounded border border-border p-2">
            <span className="flex items-center gap-2 text-xs">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden /> Private mempool
            </span>
            <Switch
              checked={status.privateMempoolActive}
              onCheckedChange={v => nonceDefender.setPrivateMempool(v)}
              aria-label="Toggle private mempool routing"
            />
          </div>
          <div className="flex items-center justify-between rounded border border-border p-2 text-xs">
            <span className="flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden /> ECDSA rotation
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {DEFENSE_PARAMS.NONCE_ROTATION_INTERVAL_MS / 3600000}h · {DEFENSE_PARAMS.MIN_CONFIRMATIONS} conf
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportCsv} disabled={!log.length}>
            <Download className="h-3 w-3 mr-1" /> Export log
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => nonceDefender.clearBlacklist()} disabled={!blacklist.length}>
            <Ban className="h-3 w-3 mr-1" /> Clear blacklist
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => nonceDefender.reset()}>
            <Trash2 className="h-3 w-3 mr-1" /> Reset session
          </Button>
        </div>
      </Card>

      <Tabs defaultValue="attacks">
        <TabsList className="h-7">
          <TabsTrigger value="attacks" className="text-[11px] h-6">Attacks</TabsTrigger>
          <TabsTrigger value="manip" className="text-[11px] h-6">Manipulation</TabsTrigger>
          <TabsTrigger value="log" className="text-[11px] h-6">Event log</TabsTrigger>
          <TabsTrigger value="blacklist" className="text-[11px] h-6">Blacklist</TabsTrigger>
        </TabsList>

        <TabsContent value="attacks">
          <ScrollArea className="h-72 rounded border border-border">
            {attacks.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No attacks detected this session.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {attacks.map(a => (
                  <li key={a.id} className="p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-display tracking-wide text-destructive">{a.attackType.replace('_', ' ')}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{ago(a.timestamp)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 font-mono break-all">
                      {a.attackerAddress}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      conf {(a.confidence * 100).toFixed(0)}% · markets {a.affectedMarkets?.length ?? 0}
                      {a.estimatedProfit ? ` · est. attacker profit $${a.estimatedProfit.toFixed(0)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="manip">
          <ScrollArea className="h-72 rounded border border-border">
            {manipulations.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No manipulation signals.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {manipulations.map((m, i) => (
                  <li key={i} className="p-2.5 text-xs flex items-center justify-between gap-2">
                    <div>
                      <div className="font-display text-warning tracking-wide">{m.type}</div>
                      <div className="text-[11px] text-muted-foreground">{m.marketSlug}</div>
                    </div>
                    <div className="text-right font-mono text-[10px] text-muted-foreground">
                      <div>impact {(m.estimatedImpact * 100).toFixed(2)}%</div>
                      <div>conf {(m.confidence * 100).toFixed(0)}% · {m.recommendedAction}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="log">
          <ScrollArea className="h-72 rounded border border-border">
            {log.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No defense events yet.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {log.map(e => (
                  <li key={e.id} className="p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={e.severity === 'critical' ? 'text-destructive' : e.severity === 'warning' ? 'text-warning' : 'text-foreground'}>
                        {e.title}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{ago(e.ts)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{e.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="blacklist">
          <ScrollArea className="h-72 rounded border border-border">
            {blacklist.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">Blacklist is empty.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {blacklist.map(a => (
                  <li key={a} className="p-2 text-[11px] font-mono break-all text-muted-foreground">{a}</li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DefensePanel;
