import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { History, Play, Loader2, Download, FileText, Wand2 } from 'lucide-react';
import { runBacktest, type BacktestConfig, type BacktestResult } from '@/lib/backtest-engine';
import { downloadCSV, downloadPDF } from '@/lib/exporters';
import type { TradeSettings } from '@/lib/neural-bot-engine';

const defaultConfig: BacktestConfig = {
  durationDays: 30,
  initialCapital: 10000,
  marketCount: 20,
  granularity: 'hourly',
  stopLoss: 0.10,
  takeProfit: 0.30,
  maxPositionSize: 1000,
  maxActiveMarkets: 8,
};

interface BacktestPanelProps {
  liveSettings?: TradeSettings | null;
  initialCapital?: number;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-display">{label}</label>
    {children}
  </div>
);

const num = "h-8 w-full bg-background border border-border rounded px-2 text-xs font-mono text-foreground";

const BacktestPanel: React.FC<BacktestPanelProps> = ({ liveSettings, initialCapital }) => {
  const [config, setConfig] = useState<BacktestConfig>(defaultConfig);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [usedLive, setUsedLive] = useState(false);

  const update = <K extends keyof BacktestConfig>(k: K, v: BacktestConfig[K]) =>
    setConfig(prev => ({ ...prev, [k]: v }));

  const applyLiveSettings = () => {
    if (!liveSettings) return;
    setConfig(prev => ({
      ...prev,
      stopLoss: liveSettings.stopLossPct,
      takeProfit: liveSettings.takeProfitPct,
      initialCapital: initialCapital ?? prev.initialCapital,
      maxPositionSize: Math.max(50, Math.round((initialCapital ?? prev.initialCapital) * liveSettings.maxPositionPct)),
    }));
  };

  const runWith = (cfg: BacktestConfig, live: boolean) => {
    setRunning(true);
    setUsedLive(live);
    setTimeout(() => {
      try { setResult(runBacktest(cfg)); }
      finally { setRunning(false); }
    }, 50);
  };
  const run = () => runWith(config, false);
  const runLive = () => {
    if (!liveSettings) return;
    const merged: BacktestConfig = {
      ...config,
      stopLoss: liveSettings.stopLossPct,
      takeProfit: liveSettings.takeProfitPct,
      initialCapital: initialCapital ?? config.initialCapital,
      maxPositionSize: Math.max(50, Math.round((initialCapital ?? config.initialCapital) * liveSettings.maxPositionPct)),
    };
    setConfig(merged);
    runWith(merged, true);
  };

  const equityData = result?.equityCurve.map(p => ({
    t: new Date(p.t).toLocaleDateString(),
    equity: Number(p.equity.toFixed(2)),
  })) ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-primary" />
        <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">Strategy Backtest</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Duration (days)">
          <input className={num} type="number" min={1} max={365} value={config.durationDays}
                 onChange={e => update('durationDays', Number(e.target.value))} />
        </Field>
        <Field label="Capital ($)">
          <input className={num} type="number" value={config.initialCapital}
                 onChange={e => update('initialCapital', Number(e.target.value))} />
        </Field>
        <Field label="Markets">
          <input className={num} type="number" min={5} max={100} value={config.marketCount}
                 onChange={e => update('marketCount', Number(e.target.value))} />
        </Field>
        <Field label="Granularity">
          <select
            className={num}
            value={config.granularity}
            onChange={e => update('granularity', e.target.value as 'hourly' | 'daily')}
          >
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
          </select>
        </Field>
        <Field label="Stop Loss (%)">
          <input className={num} type="number" min={1} max={50} value={Math.round(config.stopLoss * 100)}
                 onChange={e => update('stopLoss', Number(e.target.value) / 100)} />
        </Field>
        <Field label="Take Profit (%)">
          <input className={num} type="number" min={5} max={200} value={Math.round(config.takeProfit * 100)}
                 onChange={e => update('takeProfit', Number(e.target.value) / 100)} />
        </Field>
        <Field label="Max Position ($)">
          <input className={num} type="number" value={config.maxPositionSize}
                 onChange={e => update('maxPositionSize', Number(e.target.value))} />
        </Field>
        <Field label="Max Markets">
          <input className={num} type="number" value={config.maxActiveMarkets}
                 onChange={e => update('maxActiveMarkets', Number(e.target.value))} />
        </Field>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Button onClick={run} disabled={running} size="sm" className="font-display tracking-wide">
          {running ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Running…</> : <><Play className="h-3.5 w-3.5 mr-2" /> Run Backtest</>}
        </Button>
        <Button
          onClick={runLive}
          disabled={running || !liveSettings}
          size="sm" variant="secondary" className="font-display tracking-wide"
          title={liveSettings ? 'Run with live dashboard trade settings' : 'Start the bot to load live settings'}
        >
          <Wand2 className="h-3.5 w-3.5 mr-2" /> Run with Current Settings
        </Button>
        {usedLive && result && (
          <span className="text-[10px] uppercase tracking-widest text-accent font-display">Live Settings Applied</span>
        )}
        <Button onClick={applyLiveSettings} disabled={!liveSettings} size="sm" variant="ghost" className="h-8 text-[10px]">
          Sync fields
        </Button>
        {result && (
          <>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => downloadCSV(
                `backtest_${Date.now()}.csv`,
                result.equityCurve.map(p => ({ timestamp: new Date(p.t).toISOString(), equity: p.equity })),
              )}
            >
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => downloadPDF(
                `backtest_${Date.now()}.pdf`,
                'Strategy Backtest Results',
                ['Timestamp', 'Equity ($)'],
                result.equityCurve.map(p => [new Date(p.t).toLocaleString(), p.equity.toFixed(2)]),
                {
                  'End Equity': `$${result.endEquity.toFixed(2)}`,
                  'Return': `${result.totalReturnPct.toFixed(2)}%`,
                  'Max DD': `${result.maxDrawdownPct.toFixed(2)}%`,
                  'Win Rate': `${(result.winRate * 100).toFixed(1)}%`,
                  'Sharpe': result.sharpeRatio.toFixed(2),
                  'Trades': result.totalTrades,
                },
              )}
            >
              <FileText className="h-3 w-3 mr-1" /> PDF
            </Button>
          </>
        )}
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <Stat label="End Equity" value={`$${result.endEquity.toFixed(2)}`} />
            <Stat label="Return" value={`${result.totalReturnPct.toFixed(2)}%`} positive={result.totalReturnPct >= 0} />
            <Stat label="Max DD" value={`${result.maxDrawdownPct.toFixed(2)}%`} negative />
            <Stat label="Win Rate" value={`${(result.winRate * 100).toFixed(1)}%`} />
            <Stat label="Sharpe" value={result.sharpeRatio.toFixed(2)} positive={result.sharpeRatio > 1} />
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Equity Curve</div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="bteq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(150, 100%, 45%)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(150, 100%, 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 7%)', border: '1px solid hsl(150, 30%, 15%)', borderRadius: 6, fontSize: 11, color: 'hsl(150, 80%, 85%)' }} />
                <Area type="monotone" dataKey="equity" stroke="hsl(150, 100%, 45%)" fill="url(#bteq)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {result.totalTrades} trades · runtime {result.runtimeMs.toFixed(0)}ms
          </p>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; positive?: boolean; negative?: boolean }> = ({ label, value, positive, negative }) => (
  <div className="rounded border border-border bg-background/40 p-2">
    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={`font-mono text-sm ${positive ? 'text-primary' : negative ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
  </div>
);

export default BacktestPanel;
