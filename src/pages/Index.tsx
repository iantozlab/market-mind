import { getMaxOrderUsd } from '@/lib/wallet-trading';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { UnifiedNeuralBot, getEnvStatus, ENV, CONFIG } from '@/lib/neural-bot-engine';
import type {
  LogEntry, BotMetrics, Market, APIStatus, MLInsights, TradeSettings,
  StrategyStatus, SignalRoute, StrategyTrigger, CooldownStatus, RansHistoryEntry, RansDiagnostics,
} from '@/lib/neural-bot-engine';
import type { RANSPlan, MarketRegime, RegimeWeights, RansThresholds } from '@/lib/rans-engine';
import { getRansThresholds, RANS_PARAMS } from '@/lib/rans-engine';
import NeuralStatusCard from '@/components/NeuralStatusCard';
import MetricCard from '@/components/MetricCard';
import TerminalLog from '@/components/TerminalLog';
import MarketList from '@/components/MarketList';
import MarketDetailPanel from '@/components/MarketDetailPanel';
import PsychologyHealthPanel, { type PsychologyHealthRow } from '@/components/PsychologyHealthPanel';
import PsychologyDiagnosticsPanel from '@/components/PsychologyDiagnosticsPanel';
import RiskAlertsPanel from '@/components/RiskAlertsPanel';
import AppNavbar from '@/components/AppNavbar';
import type { ArbitrageSignal } from '@/lib/multi-market-arbitrage';
import type { SwarmPrediction, LatencyArbEvent } from '@/lib/polyswarm-integrator';
import MetaRegimeController from '@/components/MetaRegimeController';
import StrategyStateMachineView from '@/components/StrategyStateMachineView';
import CorrelationMatrixPanel from '@/components/CorrelationMatrixPanel';
import ShadowModePanel from '@/components/ShadowModePanel';
import StrategyEventTimeline from '@/components/StrategyEventTimeline';
import ReplayQueueProgressPanel from '@/components/ReplayQueueProgressPanel';
import { appendAudit, diffSettings } from '@/lib/settings-audit';
import { useAlertsCenter } from '@/hooks/useAlertsCenter';
import { useMetricsPersistence } from '@/hooks/useMetricsPersistence';
import { useEnhancedRANS } from '@/lib/enhanced-rans-module';

const StatusPill: React.FC<{ ok: boolean; label: string; value: string; tone?: 'primary' | 'accent' }> = ({ ok, label, value, tone = 'primary' }) => {
  const dot = ok ? (tone === 'accent' ? 'bg-accent' : 'bg-primary') : 'bg-destructive';
  const ring = ok ? (tone === 'accent' ? 'border-accent/30 bg-accent/5' : 'border-primary/30 bg-primary/5') : 'border-destructive/30 bg-destructive/5';
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border ${ring} px-2.5 py-1`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${ok ? 'animate-pulse' : ''}`} />
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono text-foreground">{value}</span>
    </div>
  );
};

const NeuralBotDashboard: React.FC = () => {
  const enhancedRans = useEnhancedRANS(CONFIG.INITIAL_CAPITAL);
  const EnhancedRansPopup = enhancedRans.Popup;
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<BotMetrics>({
    totalPnL: 0, dailyPnL: 0, winRate: 0, activePositions: 0,
    anomalyScore: 0, botDetectionAccuracy: 0, tradesExecuted: 0, marketsMonitored: 0,
    sharpeRatio: 0, maxDrawdown: 0, lastGasSpike: 0,
    totalWins: 0, totalLosses: 0, totalTrades: 0,
  });
  const [anomalyHistory, setAnomalyHistory] = useState<{ time: string; score: number; threshold: number }[]>([]);
  const [pnlHistory, setPnlHistory] = useState<{ time: string; pnl: number }[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [apiStatus, setApiStatus] = useState<APIStatus>({ polymarket: false, polygon: false, dataSource: 'simulated', lastFetch: 0, marketsLoaded: 0 });
  const [psychologyHealth, setPsychologyHealth] = useState<PsychologyHealthRow[]>([]);
  const [mlInsights, setMlInsights] = useState<MLInsights | null>(null);
  const getCurrentTradeSettings = useCallback((): TradeSettings => ({
    entryWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS,
    exitWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS,
    kellyFraction: CONFIG.RISK.KELLY_FRACTION,
    maxPositionPct: CONFIG.RISK.MAX_POSITION_PCT,
    stopLossPct: CONFIG.EXITS.STOP_LOSS_PCT,
    takeProfitPct: CONFIG.EXITS.TAKE_PROFIT_PCT,
    maxDailyLoss: CONFIG.RISK.MAX_DAILY_LOSS,
    maxDrawdown: CONFIG.RISK.MAX_DRAWDOWN,
  }), []);
  const [tradeSettings, setTradeSettings] = useState<TradeSettings | null>(getCurrentTradeSettings());
  const [settingsReadyForStartup, setSettingsReadyForStartup] = useState(false);
  const [auditTick, setAuditTick] = useState(0);
  const [strategies, setStrategies] = useState<StrategyStatus[]>([]);
  const [signalRoutes, setSignalRoutes] = useState<SignalRoute[]>([]);
  const [strategyTriggers, setStrategyTriggers] = useState<StrategyTrigger[]>([]);
  const [cooldown, setCooldown] = useState<CooldownStatus | null>(null);
  const [ransPlan, setRansPlan] = useState<RANSPlan | null>(null);
  const [ransCapital, setRansCapital] = useState<number>(CONFIG.INITIAL_CAPITAL);
  const [ransRealized, setRansRealized] = useState<number>(0);
  const [ransHistory, setRansHistory] = useState<RansHistoryEntry[]>([]);
  const [ransThresholds, setRansThresholdsState] = useState<RansThresholds>(getRansThresholds());
  const [ransWeightsAll, setRansWeightsAll] = useState<Record<MarketRegime, RegimeWeights>>(RANS_PARAMS.WEIGHTS as Record<MarketRegime, RegimeWeights>);
  const [ransDiagnostics, setRansDiagnostics] = useState<RansDiagnostics | null>(null);
  const [ransKillSwitch, setRansKillSwitchState] = useState<boolean>(false);
  const [arbSignals, setArbSignals] = useState<ArbitrageSignal[]>([]);
  const [arbExecuted, setArbExecuted] = useState<ArbitrageSignal[]>([]);
  const [arbRealized, setArbRealized] = useState(0);
  const [swarmSignals, setSwarmSignals] = useState<SwarmPrediction[]>([]);
  const [swarmEvents, setSwarmEvents] = useState<LatencyArbEvent[]>([]);
  const [swarmAgentCount, setSwarmAgentCount] = useState(0);

  const alerts = useAlertsCenter();
  const botRef = useRef<UnifiedNeuralBot | null>(null);
  const [tradingMode, setTradingModeState] = useState<'PAPER' | 'LIVE'>(CONFIG.BOT_MODE);
  const [startupCapital, setStartupCapital] = useState<number>(CONFIG.INITIAL_CAPITAL);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const toggleTradingMode = useCallback(async () => {
    const next = tradingMode === 'PAPER' ? 'LIVE' : 'PAPER';
    if (!botRef.current) {
      if (next === 'LIVE' && !window.confirm(`Enable automated LIVE trading through the configured Polymarket Deposit Wallet Session Key? Orders are capped at $${getMaxOrderUsd()} and sent by the server-side Session Key. The separate EOA wallet flow is available for manually confirmed orders.`)) return;
      CONFIG.BOT_MODE = next;
      setTradingModeState(next);
      return;
    }
    if (next === 'LIVE' && !window.confirm(`Enable automated LIVE trading through the configured Polymarket Deposit Wallet Session Key? Orders are capped at $${getMaxOrderUsd()} and sent by the server-side Session Key. The separate EOA wallet flow is available for manually confirmed orders.`)) return;
    setModeBusy(true);
    setModeError(null);
    try {
      const res = await botRef.current.setTradingMode(next);
      if (!res.ok) throw new Error(res.error);
      setTradingModeState(CONFIG.BOT_MODE);
    } catch (e) {
      setModeError(e instanceof Error ? e.message : String(e));
      setTradingModeState(CONFIG.BOT_MODE);
    } finally {
      setModeBusy(false);
    }
  }, [tradingMode]);
  const persistence = useMetricsPersistence(metrics, isRunning, 30_000);


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
    setRansPlan(botRef.current.getRANSPlan());
    setRansCapital(botRef.current.getRANSCapital());
    setRansRealized(botRef.current.getRANSRealized());
    setRansHistory(botRef.current.getRansHistory());
    setRansDiagnostics(botRef.current.getRansDiagnostics());
    setRansKillSwitchState(botRef.current.isRansKillSwitch());
    setArbSignals(botRef.current.getArbSignals());
    setArbExecuted(botRef.current.getArbExecuted());
    setArbRealized(botRef.current.getArbRealized());
    setSwarmSignals(botRef.current.getSwarmSignals());
    setSwarmEvents(botRef.current.getSwarmEvents());
    setSwarmAgentCount(botRef.current.getSwarmAgentCount());
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
    const nextCapital = Number.isFinite(startupCapital) && startupCapital > 0 ? startupCapital : CONFIG.INITIAL_CAPITAL;
    CONFIG.INITIAL_CAPITAL = nextCapital;
    CONFIG.BOT_MODE = tradingMode;
    setTradingModeState(tradingMode);
    const snapshot = getCurrentTradeSettings();
    setTradeSettings(snapshot);
    setSettingsReadyForStartup(true);
    const bot = new UnifiedNeuralBot(true);
    bot.setOnUpdate(updateState);
    bot.setAlertSink((a) => alerts.push(a));
    botRef.current = bot;
    bot.run();
    setTradeSettings(bot.getTradeSettings());
    setStrategies(bot.getStrategies());
    setIsRunning(true);
  }, [updateState, alerts, getCurrentTradeSettings, startupCapital, tradingMode]);

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
    const prev = botRef.current?.getTradeSettings() ?? getCurrentTradeSettings();

    if (!botRef.current) {
      if (s.entryWindowMs != null) CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS = s.entryWindowMs;
      if (s.exitWindowMs != null) CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS = s.exitWindowMs;
      if (s.kellyFraction != null) CONFIG.RISK.KELLY_FRACTION = s.kellyFraction;
      if (s.maxPositionPct != null) CONFIG.RISK.MAX_POSITION_PCT = s.maxPositionPct;
      if (s.stopLossPct != null) CONFIG.EXITS.STOP_LOSS_PCT = s.stopLossPct;
      if (s.takeProfitPct != null) CONFIG.EXITS.TAKE_PROFIT_PCT = s.takeProfitPct;
      if (s.maxDailyLoss != null) CONFIG.RISK.MAX_DAILY_LOSS = s.maxDailyLoss;
      if (s.maxDrawdown != null) { CONFIG.RISK.MAX_DRAWDOWN = s.maxDrawdown; }
    } else {
      botRef.current.setTradeSettings(s);
    }

    const next = getCurrentTradeSettings();
    setTradeSettings(next);
    setSettingsReadyForStartup(true);
    const changes = diffSettings(prev, s);
    if (changes.length > 0) {
      void appendAudit({ actor: 'dashboard-user', changes }).then(() =>
        setAuditTick(t => t + 1),
      );
    }
  }, [getCurrentTradeSettings]);

  const applyRansThresholds = useCallback((p: Partial<RansThresholds>) => {
    botRef.current?.setRansThresholds(p);
    setRansThresholdsState(getRansThresholds());
  }, []);
  const applyRansWeights = useCallback((regime: MarketRegime, w: Partial<RegimeWeights>) => {
    botRef.current?.setRansWeights(regime, w);
    setRansWeightsAll({ ...RANS_PARAMS.WEIGHTS } as Record<MarketRegime, RegimeWeights>);
  }, []);
  const toggleRansKillSwitch = useCallback((on: boolean) => {
    botRef.current?.setRansKillSwitch(on, on ? 'manual-dashboard' : 'manual-resume');
    setRansKillSwitchState(on);
  }, []);

  const selectedOrderBook = selectedMarket && botRef.current ? botRef.current.getOrderBook(selectedMarket.id) : null;
  const selectedTrades = selectedMarket && botRef.current ? botRef.current.getTrades(selectedMarket.id) : [];

  const triggerByName = new Map(strategyTriggers.map(t => [t.strategy, t]));

  return (
    <div className="min-h-screen bg-background">
      {!isRunning && (
        <div className="px-4 pt-4 md:px-6">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-3 shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Capital to trade
                <input
                  type="number"
                  min={1}
                  step={100}
                  value={startupCapital}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) {
                      setStartupCapital(next);
                      CONFIG.INITIAL_CAPITAL = next;
                    }
                  }}
                  className="h-8 w-28 rounded border border-border bg-background px-2 text-xs font-mono text-foreground"
                  aria-label="Capital to trade"
                />
              </label>
              <button
                type="button"
                onClick={toggleTradingMode}
                className={`inline-flex items-center rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${tradingMode === 'LIVE' ? 'border-destructive text-destructive bg-destructive/10' : 'border-primary/50 text-primary bg-primary/10'}`}
                aria-label="Toggle trading mode"
              >
                Mode: {tradingMode}
              </button>
            </div>
            {settingsReadyForStartup && (
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[10px] font-display uppercase tracking-[0.2em] text-primary shadow-[0_0_12px_rgba(59,130,246,0.25)]">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Settings ready on startup
              </div>
            )}
          </div>
        </div>
      )}

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
        ransPlan={ransPlan}
        ransCapital={ransCapital}
        ransRealized={ransRealized}
        ransHistory={ransHistory}
        ransThresholds={ransThresholds}
        ransWeightsAll={ransWeightsAll}
        ransDiagnostics={ransDiagnostics}
        ransKillSwitch={ransKillSwitch}
        arbSignals={arbSignals}
        arbExecuted={arbExecuted}
        arbRealized={arbRealized}
        swarmSignals={swarmSignals}
        swarmEvents={swarmEvents}
        swarmAgentCount={swarmAgentCount}
        onApplyRansThresholds={applyRansThresholds}
        onApplyRansWeights={applyRansWeights}
        onToggleRansKillSwitch={toggleRansKillSwitch}
        alerts={{
          items: alerts.alerts,
          unread: alerts.unread,
          open: alerts.open,
          setOpen: alerts.setOpen,
          clear: alerts.clear,
          markRead: alerts.markRead,
          markAllRead: alerts.markAllRead,
          rules: alerts.rules,
          suppressed: alerts.suppressed,
          clearSuppressed: alerts.clearSuppressed,
        }}
      />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded focus:border focus:border-primary focus:bg-background focus:px-3 focus:py-1.5 focus:text-xs focus:font-display focus:tracking-wide focus:text-primary focus:shadow-lg"
      >
        Skip to content
      </a>

      <main id="main-content" tabIndex={-1} className="p-4 md:p-6 space-y-6 outline-none">
        {/* Hero header */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card via-card/80 to-background p-5 md:p-6">
          <div className="pointer-events-none absolute inset-0 scanline opacity-40" />
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className={`h-2 w-2 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {isRunning ? 'System Online' : 'Standby'}
              </span>
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground text-glow tracking-tight">
              Polymarket Neural Trading System
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1 tracking-widest uppercase">
              HTM · Transformer · Contrastive · MAML · 12 Exploit Strategies · 50k Gen Evolution
            </p>
            {isRunning && (
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <StatusPill ok={apiStatus.polymarket} label="Polymarket" value={apiStatus.polymarket ? 'Connected' : 'Down'} />
                <StatusPill ok={apiStatus.dataSource === 'live'} label="Data" value={apiStatus.dataSource === 'live' ? `LIVE · ${metrics.marketsMonitored}` : 'SIM'} />
                <StatusPill ok={!!getEnvStatus().polymarketApiKey} label="API Key" value={getEnvStatus().polymarketApiKey ? 'OK' : 'Missing'} />
                <button
                  type="button"
                  onClick={toggleTradingMode}
                  disabled={modeBusy}
                  aria-pressed={tradingMode === 'LIVE'}
                  title={modeError ?? (tradingMode === 'LIVE' ? 'Click to return to PAPER' : 'Click to enable LIVE trading')}
                  className={`rounded border px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-50 ${tradingMode === 'LIVE' ? 'border-destructive text-destructive bg-destructive/10' : 'border-primary/50 text-primary bg-primary/10'}`}
                >
                  Mode: {modeBusy ? 'checking…' : tradingMode} ⇄
                </button>
                {modeError && <span role="alert" className="text-[10px] font-mono text-destructive">{modeError}</span>}
                <StatusPill ok={enhancedRans.killLevel === 'none'} label="RANS" value={enhancedRans.killLevel === 'none' ? 'Stable' : enhancedRans.killLevel} tone="accent" />
                <StatusPill ok label="Capital" value={`$${CONFIG.INITIAL_CAPITAL.toLocaleString()}`} tone="accent" />
                <StatusPill
                  ok={!persistence.lastError && persistence.queueDepth === 0}
                  label="Snapshot"
                  value={
                    persistence.lastSavedAt
                      ? `${new Date(persistence.lastSavedAt).toLocaleTimeString()}${persistence.queueDepth ? ` · queued ${persistence.queueDepth}` : ''}`
                      : persistence.queueDepth
                        ? `queued ${persistence.queueDepth}`
                        : 'pending'
                  }
                />
                <EnhancedRansPopup />
                {persistence.lastFlush && (
                  <div
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                      persistence.lastFlush.status === 'ok'
                        ? 'border-primary/30 bg-primary/5'
                        : persistence.lastFlush.status === 'error'
                          ? 'border-destructive/30 bg-destructive/5'
                          : 'border-warning/30 bg-warning/5'
                    }`}
                    title={persistence.lastFlush.message || ''}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        persistence.lastFlush.status === 'ok'
                          ? 'bg-primary'
                          : persistence.lastFlush.status === 'error'
                            ? 'bg-destructive'
                            : 'bg-warning animate-pulse'
                      }`}
                    />
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                      {persistence.isReplaying ? 'Replaying' : 'Last flush'}
                    </span>
                    <span className="text-[10px] font-mono text-foreground">
                      {persistence.lastFlush.status.toUpperCase()} · {new Date(persistence.lastFlush.ts).toLocaleTimeString()}
                      {persistence.retryCount > 0 && ` · ×${persistence.retryCount}`}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { void persistence.flushNow(); }}
                  disabled={persistence.isFlushing}
                  className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-border hover:border-primary hover:text-primary disabled:opacity-50"
                  aria-label="Flush pending snapshots now"
                >
                  {persistence.isFlushing ? 'Flushing…' : 'Flush now'}
                </button>
              </div>
            )}
            {isRunning && persistence.attempts.length > 0 && (
              <div className="mt-3 rounded border border-border bg-background/40 p-2 max-w-2xl">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                    Persistence log · last {persistence.attempts.length}
                  </div>
                  <button
                    onClick={persistence.clearAttempts}
                    className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5"
                    aria-label="Clear persistence attempt log"
                  >
                    Clear
                  </button>
                </div>
                <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                  {persistence.attempts.slice(0, 6).map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          a.status === 'ok' ? 'bg-primary' : a.status === 'retrying' ? 'bg-warning' : 'bg-destructive'
                        }`}
                      />
                      <span className="text-muted-foreground w-16 shrink-0">{new Date(a.ts).toLocaleTimeString()}</span>
                      <span className="uppercase w-14 shrink-0">{a.status}</span>
                      <span className="text-muted-foreground">n={a.count}</span>
                      {a.message && <span className="text-destructive/80 truncate">{a.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ReplayQueueProgressPanel
              isReplaying={persistence.isReplaying}
              isFlushing={persistence.isFlushing}
              pendingQueue={persistence.pendingQueue}
            />

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

        {/* Advanced Strategy Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MetaRegimeController
            metrics={metrics}
            isRunning={isRunning}
            onApplyThresholds={applyRansThresholds}
          />
          <StrategyStateMachineView
            strategies={strategies}
            triggers={strategyTriggers}
            isRunning={isRunning}
            activePositions={metrics.activePositions}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CorrelationMatrixPanel strategies={strategies} triggers={strategyTriggers} />
          <ShadowModePanel strategies={strategies} triggers={strategyTriggers} />
        </div>

        <StrategyEventTimeline
          strategies={strategies}
          triggers={strategyTriggers}
          activePositions={metrics.activePositions}
          isRunning={isRunning}
        />

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
      </main>
    </div>
  );
};

export default NeuralBotDashboard;
