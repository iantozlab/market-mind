import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { UnifiedNeuralBot, getEnvStatus, ENV, CONFIG } from '@/lib/neural-bot-engine';
import type {
  LogEntry, BotMetrics, Market, APIStatus, MLInsights, TradeSettings,
  StrategyStatus, SignalRoute, StrategyTrigger, CooldownStatus,
} from '@/lib/neural-bot-engine';
import type { RANSPlan } from '@/lib/rans-engine';
import NeuralStatusCard from '@/components/NeuralStatusCard';
import MetricCard from '@/components/MetricCard';
import TerminalLog from '@/components/TerminalLog';
import MarketList from '@/components/MarketList';
import MarketDetailPanel from '@/components/MarketDetailPanel';
import PsychologyHealthPanel, { type PsychologyHealthRow } from '@/components/PsychologyHealthPanel';
import PsychologyDiagnosticsPanel from '@/components/PsychologyDiagnosticsPanel';
import RiskAlertsPanel from '@/components/RiskAlertsPanel';
import AppNavbar from '@/components/AppNavbar';
import { appendAudit, diffSettings } from '@/lib/settings-audit';
import { useAlertsCenter } from '@/hooks/useAlertsCenter';

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
  const [apiStatus, setApiStatus] = useState<APIStatus>({ polymarket: false, polygon: false, dataSource: 'simulated', lastFetch: 0, marketsLoaded: 0 });
  const [psychologyHealth, setPsychologyHealth] = useState<PsychologyHealthRow[]>([]);
  const [mlInsights, setMlInsights] = useState<MLInsights | null>(null);
  const [tradeSettings, setTradeSettings] = useState<TradeSettings | null>(null);
  const [auditTick, setAuditTick] = useState(0);
  const [strategies, setStrategies] = useState<StrategyStatus[]>([]);
  const [signalRoutes, setSignalRoutes] = useState<SignalRoute[]>([]);
  const [strategyTriggers, setStrategyTriggers] = useState<StrategyTrigger[]>([]);
  const [cooldown, setCooldown] = useState<CooldownStatus | null>(null);

  const alerts = useAlertsCenter();
  const botRef = useRef<UnifiedNeuralBot | null>(null);

  const updateState = useCallback(() => {
    if (!botRef.current) return;
    const m = botRef.current.getMetrics();
    setLogs(botRef.current.getLogs());
    setMetrics(m);
    setMarkets(botRef.current.getMarkets());
    setApiStatus(botRef.current.getAPIStatus());
    const health = botRef.current.getPsychologyHealth();
    setPsychologyHealth(Array.from(health.entries()).map(([name, d]) => ({ name, ...d })));
    setMlInsights(botRef.current.getMLInsights());
    setStrategies(botRef.current.getStrategies());
    setSignalRoutes(botRef.current.getSignalRoutes());
    setStrategyTriggers(botRef.current.getStrategyTriggers());
    setCooldown(botRef.current.getCooldownStatus());
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
    bot.setAlertSink((a) => alerts.push(a));
    botRef.current = bot;
    bot.run();
    setTradeSettings(bot.getTradeSettings());
    setStrategies(bot.getStrategies());
    setIsRunning(true);
  }, [updateState, alerts]);

  const stopBot = useCallback(() => {
    botRef.current?.stop();
    setIsRunning(false);
  }, []);

  useEffect(() => {
    return () => { botRef.current?.stop(); };
  }, []);

  // Refresh cooldown countdown every second so the UI shows live ticking down.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      if (botRef.current) setCooldown(botRef.current.getCooldownStatus());
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const applyTradeSettings = useCallback((s: Partial<TradeSettings>) => {
    const prev = botRef.current?.getTradeSettings();
    botRef.current?.setTradeSettings(s);
    const next = botRef.current?.getTradeSettings();
    if (next) setTradeSettings(next);
    if (prev) {
      const changes = diffSettings(prev, s);
      if (changes.length > 0) {
        void appendAudit({ actor: 'dashboard-user', changes }).then(() =>
          setAuditTick(t => t + 1),
        );
      }
    }
  }, []);

  const selectedOrderBook = selectedMarket && botRef.current ? botRef.current.getOrderBook(selectedMarket.id) : null;
  const selectedTrades = selectedMarket && botRef.current ? botRef.current.getTrades(selectedMarket.id) : [];

  const triggerByName = new Map(strategyTriggers.map(t => [t.strategy, t]));

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar
        isRunning={isRunning}
        onStart={startBot}
        onStop={stopBot}
        tradeSettings={tradeSettings}
        applyTradeSettings={applyTradeSettings}
        mlInsights={mlInsights}
        metrics={metrics}
        initialCapital={CONFIG.INITIAL_CAPITAL}
        maxDrawdownLimit={tradeSettings?.maxDrawdown ?? 0.20}
        dailyLossLimit={tradeSettings?.maxDailyLoss ?? ENV.MAX_DAILY_LOSS}
        strategies={strategies}
        auditTick={auditTick}
        alerts={{
          items: alerts.alerts,
          unread: alerts.unread,
          open: alerts.open,
          setOpen: alerts.setOpen,
          clear: alerts.clear,
        }}
      />

      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground text-glow tracking-tight">
            Polymarket Neural Trading System
          </h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase">
            HTM · Transformer · Contrastive · MAML · 12 Exploit Strategies · 50k Gen Evolution
          </p>
          {isRunning && (
            <div className="flex flex-wrap items-center gap-3 mt-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${apiStatus.polymarket ? 'bg-primary' : 'bg-warning'}`} />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  Polymarket API: {apiStatus.polymarket ? 'Connected' : 'Unreachable'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${apiStatus.dataSource === 'live' ? 'bg-primary' : 'bg-accent'}`} />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  Data: {apiStatus.dataSource === 'live' ? `LIVE (${metrics.marketsMonitored} markets)` : 'SIMULATED'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${getEnvStatus().polymarketApiKey ? 'bg-primary' : 'bg-destructive'}`} />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  API Key: {getEnvStatus().polymarketApiKey ? 'Configured' : 'Missing'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="text-[10px] text-muted-foreground tracking-wide">
                  Mode: {CONFIG.BOT_MODE} · Capital: ${CONFIG.INITIAL_CAPITAL.toLocaleString()}
                </span>
              </div>
            </div>
          )}
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

        {/* Risk threshold alerts (homepage) */}
        <RiskAlertsPanel
          metrics={metrics}
          maxDrawdownLimit={tradeSettings?.maxDrawdown ?? 0.20}
          dailyLossLimit={tradeSettings?.maxDailyLoss ?? ENV.MAX_DAILY_LOSS}
          maxPositions={8}
          cooldown={cooldown}
          isRunning={isRunning}
          onEmergencyStop={stopBot}
        />

        {/* Charts + Markets */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">HTM Anomaly Detection</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={anomalyHistory}>
                  <defs>
                    <linearGradient id="anomalyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11, color: 'hsl(var(--foreground))' }} />
                  <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill="url(#anomalyGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="threshold" stroke="hsl(var(--destructive))" strokeDasharray="4 4" fill="none" strokeWidth={1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">Cumulative P&L</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pnlHistory}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11, color: 'hsl(var(--foreground))' }} />
                  <Area type="monotone" dataKey="pnl" stroke="hsl(var(--accent))" fill="url(#pnlGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <MarketList markets={markets} onSelect={setSelectedMarket} />
          </div>
        </div>

        {/* Psychology + Diagnostics */}
        <PsychologyHealthPanel
          rows={psychologyHealth}
          isRunning={isRunning}
          getRecentTrades={(name) => botRef.current?.getPsychologyRecentTrades(name) ?? []}
          onThresholdChange={(t) => botRef.current?.setPsychologyThreshold(t)}
        />

        {/* Why-active explanations */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold text-foreground mb-3 tracking-wide">
            Why Each Strategy Is Active
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {psychologyHealth.map(r => {
              const tr = triggerByName.get(r.name);
              const fresh = tr && Date.now() - tr.ts < 60_000;
              return (
                <div key={r.name} className={`rounded border px-3 py-2 ${fresh ? 'border-primary/30 bg-primary/5' : 'border-border bg-background/40'}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-display text-foreground capitalize">{r.name.replace(/_/g, ' ')}</span>
                    <span className={`text-[10px] font-mono ${fresh ? 'text-primary' : 'text-muted-foreground'}`}>
                      {tr ? `${Math.floor((Date.now() - tr.ts) / 1000)}s` : '—'}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {tr ? <>Trigger: <span className="font-mono text-accent">{tr.reason}</span> · conf {(tr.confidence * 100).toFixed(0)}%</> : 'Awaiting first trigger…'}
                  </div>
                  {tr && Object.keys(tr.metrics).length > 0 && (
                    <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate">
                      {Object.entries(tr.metrics).map(([k, v]) => `${k}=${v}`).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
            {psychologyHealth.length === 0 && (
              <p className="col-span-full text-xs text-muted-foreground text-center py-4">
                Start the bot to see live trigger reasons per strategy.
              </p>
            )}
          </div>
        </div>

        <PsychologyDiagnosticsPanel routes={signalRoutes} />

        {/* Terminal */}
        <div>
          <h2 className="font-display text-sm font-semibold text-foreground mb-2 tracking-wide">Neural Network Activity Log</h2>
          <TerminalLog logs={logs} />
        </div>

        <p className="text-center text-[10px] text-muted-foreground tracking-widest uppercase">
          Exclusive Architecture · Evolved Parameters (50k Gen) · 12 Exploit Strategies · Anti-Detection Active · Paper Trading Mode
        </p>

        <MarketDetailPanel
          market={selectedMarket}
          orderBook={selectedOrderBook}
          trades={selectedTrades}
          open={!!selectedMarket}
          onClose={() => setSelectedMarket(null)}
        />
      </div>
    </div>
  );
};

export default NeuralBotDashboard;
