import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { UnifiedNeuralBot } from '@/lib/neural-bot-engine';
import type { LogEntry, BotMetrics, Market, APIStatus, Position } from '@/lib/neural-bot-engine';
import NeuralStatusCard from '@/components/NeuralStatusCard';
import MetricCard from '@/components/MetricCard';
import TerminalLog from '@/components/TerminalLog';
import MarketList from '@/components/MarketList';
import MarketDetailPanel from '@/components/MarketDetailPanel';
import PositionsTracker from '@/components/PositionsTracker';
import { Button } from '@/components/ui/button';

const NeuralBotDashboard: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<BotMetrics>({
    totalPnL: 0, dailyPnL: 0, winRate: 0, activePositions: 0,
    anomalyScore: 0, botDetectionAccuracy: 0, tradesExecuted: 0, marketsMonitored: 0,
    sharpeRatio: 0, maxDrawdown: 0, lastGasSpike: 0,
  });
  const [anomalyHistory, setAnomalyHistory] = useState<{ time: string; score: number; threshold: number }[]>([]);
  const [pnlHistory, setPnlHistory] = useState<{ time: string; pnl: number }[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [apiStatus, setApiStatus] = useState<APIStatus>({ polymarket: false, dataSource: 'simulated', lastFetch: 0, marketsLoaded: 0 });

  const botRef = useRef<UnifiedNeuralBot | null>(null);

  const updateState = useCallback(() => {
    if (!botRef.current) return;
    const m = botRef.current.getMetrics();
    setLogs(botRef.current.getLogs());
    setMetrics(m);
    setMarkets(botRef.current.getMarkets());
    setApiStatus(botRef.current.getAPIStatus());
    setAnomalyHistory(prev => {
      const next = [...prev, { time: new Date().toLocaleTimeString(), score: m.anomalyScore * 100, threshold: 70 }];
      return next.slice(-30);
    });
    setPnlHistory(prev => {
      const next = [...prev, { time: new Date().toLocaleTimeString(), pnl: m.totalPnL }];
      return next.slice(-30);
    });
  }, []);

  const startBot = useCallback(() => {
    const bot = new UnifiedNeuralBot(true);
    bot.setOnUpdate(updateState);
    botRef.current = bot;
    bot.run();
    setIsRunning(true);
  }, [updateState]);

  const stopBot = useCallback(() => {
    botRef.current?.stop();
    setIsRunning(false);
  }, []);

  useEffect(() => {
    return () => { botRef.current?.stop(); };
  }, []);

  const selectedOrderBook = selectedMarket && botRef.current ? botRef.current.getOrderBook(selectedMarket.id) : null;
  const selectedTrades = selectedMarket && botRef.current ? botRef.current.getTrades(selectedMarket.id) : [];

  const strategyLabels = [
    'HTM Anomaly', 'Transformer', 'Contrastive', 'MAML',
    'Gas Shadow', 'ZK Exploit', 'Liquidity Vortex', '47s Window',
    'Consensus Failure', 'Bot Exhaustion', 'Whale Inactivity', 'Anti-Detection',
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground text-glow tracking-tight">
            Polymarket Neural Trading System
          </h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase">
            HTM · Transformer · Contrastive · MAML · 12 Exploit Strategies · 50k Gen Evolution
          </p>
          {isRunning && (
            <div className="flex items-center gap-3 mt-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${apiStatus.polymarket ? 'bg-primary' : 'bg-warning'}`} />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  Polymarket API: {apiStatus.polymarket ? 'Connected' : 'Unreachable'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${apiStatus.dataSource === 'live' ? 'bg-primary' : 'bg-accent'}`} />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  Data: {apiStatus.dataSource === 'live' ? `LIVE (${apiStatus.marketsLoaded} markets)` : 'SIMULATED'}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-primary animate-pulse-glow' : 'bg-muted-foreground'}`} />
          <span className="text-xs text-muted-foreground">{isRunning ? 'LIVE' : 'OFFLINE'}</span>
          <Button
            onClick={isRunning ? stopBot : startBot}
            variant={isRunning ? 'destructive' : 'default'}
            size="sm"
            className="font-display tracking-wide"
          >
            {isRunning ? '■ STOP' : '▶ START'}
          </Button>
        </div>
      </div>

      {/* Neural Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NeuralStatusCard
          title="HTM"
          status={metrics.anomalyScore > 0.5 ? '⚠ ANOMALY' : '● NORMAL'}
          detail={`Score: ${(metrics.anomalyScore * 100).toFixed(1)}%`}
          isActive={isRunning}
          color={metrics.anomalyScore > 0.7 ? 'warning' : 'primary'}
        />
        <NeuralStatusCard title="Transformer" status="CROSS-ATTN" detail="8 Evolved Heads" isActive={isRunning} color="accent" />
        <NeuralStatusCard
          title="Contrastive"
          status={`${(metrics.botDetectionAccuracy * 100).toFixed(0)}%`}
          detail="Bot Detection"
          isActive={isRunning}
          color="info"
        />
        <NeuralStatusCard title="MAML" status="ADAPTIVE" detail="Meta-Learning" isActive={isRunning} color="warning" />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <MetricCard label="Total P&L" value={`$${metrics.totalPnL.toFixed(2)}`} trend={metrics.totalPnL > 0 ? 'up' : metrics.totalPnL < 0 ? 'down' : 'neutral'} />
        <MetricCard label="Daily P&L" value={`$${metrics.dailyPnL.toFixed(2)}`} trend={metrics.dailyPnL > 0 ? 'up' : metrics.dailyPnL < 0 ? 'down' : 'neutral'} />
        <MetricCard label="Win Rate" value={`${(metrics.winRate * 100).toFixed(1)}%`} trend={metrics.winRate > 0.5 ? 'up' : 'neutral'} />
        <MetricCard label="Positions" value={String(metrics.activePositions)} />
        <MetricCard label="Trades" value={String(metrics.tradesExecuted)} />
        <MetricCard label="Markets" value={String(metrics.marketsMonitored)} />
        <MetricCard label="Sharpe" value={metrics.sharpeRatio.toFixed(2)} trend={metrics.sharpeRatio > 1 ? 'up' : metrics.sharpeRatio < 0 ? 'down' : 'neutral'} />
        <MetricCard label="Max DD" value={`${(metrics.maxDrawdown * 100).toFixed(1)}%`} trend={metrics.maxDrawdown > 0.1 ? 'down' : 'neutral'} />
      </div>

      {/* Active Strategies */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">Active Strategies</h2>
        <div className="flex flex-wrap gap-2">
          {strategyLabels.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-display tracking-wide transition-all duration-300 ${
                isRunning
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Charts + Markets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Charts column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Anomaly Chart */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">HTM Anomaly Detection</h2>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={anomalyHistory}>
                <defs>
                  <linearGradient id="anomalyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(150, 100%, 45%)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(150, 100%, 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 7%)', border: '1px solid hsl(150, 30%, 15%)', borderRadius: 6, fontSize: 11, color: 'hsl(150, 80%, 85%)' }} />
                <Area type="monotone" dataKey="score" stroke="hsl(150, 100%, 45%)" fill="url(#anomalyGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="threshold" stroke="hsl(0, 80%, 55%)" strokeDasharray="4 4" fill="none" strokeWidth={1} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* P&L Chart */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">Cumulative P&L</h2>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={pnlHistory}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(280, 100%, 60%)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(280, 100%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(220, 10%, 50%)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 7%)', border: '1px solid hsl(150, 30%, 15%)', borderRadius: 6, fontSize: 11, color: 'hsl(150, 80%, 85%)' }} />
                <Area type="monotone" dataKey="pnl" stroke="hsl(280, 100%, 60%)" fill="url(#pnlGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Markets column */}
        <div>
          <MarketList markets={markets} onSelect={setSelectedMarket} />
        </div>
      </div>

      {/* Terminal */}
      <div>
        <h2 className="font-display text-sm font-semibold text-foreground mb-2 tracking-wide">Neural Network Activity Log</h2>
        <TerminalLog logs={logs} />
      </div>

      {/* Footer */}
      <p className="text-center text-[10px] text-muted-foreground tracking-widest uppercase">
        Exclusive Architecture · Evolved Parameters (50k Gen) · 12 Exploit Strategies · Anti-Detection Active · Paper Trading Mode
      </p>

      {/* Market Detail Panel */}
      <MarketDetailPanel
        market={selectedMarket}
        orderBook={selectedOrderBook}
        trades={selectedTrades}
        open={!!selectedMarket}
        onClose={() => setSelectedMarket(null)}
      />
    </div>
  );
};

export default NeuralBotDashboard;
