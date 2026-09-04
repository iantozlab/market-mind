import React, { useEffect, useState } from 'react';
import {
  Sliders, Brain, Shield, History, Layers, ChevronDown, Cpu, Menu, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import ThemeToggle from './ThemeToggle';
import AlertsBell from './AlertsBell';
import TradeSettingsPanel from './TradeSettingsPanel';
import MLInsightsPanel from './MLInsightsPanel';
import RiskDashboardPanel from './RiskDashboardPanel';
import DrawdownGuardPanel from './DrawdownGuardPanel';
import DrawdownIncidentsPanel from './DrawdownIncidentsPanel';


import BacktestPanel from './BacktestPanel';
import SettingsAuditPanel from './SettingsAuditPanel';
import RansPanel from './RansPanel';
import ArbSwarmPanel from './ArbSwarmPanel';
import DefensePanel from './DefensePanel';
import type { ArbitrageSignal } from '@/lib/multi-market-arbitrage';
import type { SwarmPrediction, LatencyArbEvent } from '@/lib/polyswarm-integrator';
import type {
  TradeSettings, MLInsights, BotMetrics, StrategyStatus, RansHistoryEntry, RansDiagnostics,
} from '@/lib/neural-bot-engine';
import type { RANSPlan, MarketRegime, RegimeWeights, RansThresholds } from '@/lib/rans-engine';
import type { AlertItem } from '@/hooks/useAlertsCenter';
import type { AlertRules } from '@/lib/alert-rules';

type SheetKey = null | 'settings' | 'ml' | 'risk' | 'backtest' | 'rans' | 'arb' | 'defense';
const SHEET_STORAGE_KEY = 'app_last_sheet_v1';

interface Props {
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;

  tradeSettings: TradeSettings | null;
  applyTradeSettings: (s: Partial<TradeSettings>) => void;

  mlInsights: MLInsights | null;

  metrics: BotMetrics;
  initialCapital: number;
  maxDrawdownLimit: number;
  dailyLossLimit: number;

  strategies: StrategyStatus[];
  auditTick: number;

  ransPlan: RANSPlan | null;
  ransCapital: number;
  ransRealized: number;
  ransHistory: RansHistoryEntry[];
  ransThresholds: RansThresholds;
  ransWeightsAll: Record<MarketRegime, RegimeWeights>;
  ransDiagnostics: RansDiagnostics | null;
  ransKillSwitch: boolean;
  onApplyRansThresholds: (p: Partial<RansThresholds>) => void;
  onApplyRansWeights: (regime: MarketRegime, w: Partial<RegimeWeights>) => void;
  onToggleRansKillSwitch: (on: boolean) => void;

  arbSignals: ArbitrageSignal[];
  arbExecuted: ArbitrageSignal[];
  arbRealized: number;
  swarmSignals: SwarmPrediction[];
  swarmEvents: LatencyArbEvent[];
  swarmAgentCount: number;

  alerts: {
    items: AlertItem[];
    unread: number;
    open: boolean;
    setOpen: (o: boolean) => void;
    clear: () => void;
    markRead: (id: string) => void;
    markAllRead: () => void;
    rules: AlertRules;
    suppressed: number;
    clearSuppressed: () => void;
  };
}

const NAV_ITEMS: { key: Exclude<SheetKey, null>; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'settings', label: 'Trade Settings', Icon: Sliders },
  { key: 'ml',       label: 'ML Insights',    Icon: Brain },
  { key: 'risk',     label: 'Risk',           Icon: Shield },
  { key: 'backtest', label: 'Backtest',       Icon: History },
  { key: 'rans',     label: 'RANS',           Icon: Cpu },
  { key: 'arb',      label: 'Arb & Swarm',    Icon: Layers },
  { key: 'defense',  label: 'Defense',        Icon: ShieldCheck },
];

const AppNavbar: React.FC<Props> = ({
  isRunning, onStart, onStop,
  tradeSettings, applyTradeSettings,
  mlInsights, metrics, initialCapital, maxDrawdownLimit, dailyLossLimit,
  strategies, auditTick, alerts,
  ransPlan, ransCapital, ransRealized, ransHistory,
  ransThresholds, ransWeightsAll, ransDiagnostics, ransKillSwitch,
  onApplyRansThresholds, onApplyRansWeights, onToggleRansKillSwitch,
  arbSignals, arbExecuted, arbRealized, swarmSignals, swarmEvents, swarmAgentCount,
}) => {
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastSheet, setLastSheet] = useState<SheetKey>(() => {
    try {
      const v = localStorage.getItem(SHEET_STORAGE_KEY);
      if (v && ['settings','ml','risk','backtest','rans','arb','defense'].includes(v)) return v as SheetKey;
    } catch { /* noop */ }
    return null;
  });

  const open = (k: SheetKey) => {
    setSheet(k); setMobileOpen(false);
    if (k) { setLastSheet(k); try { localStorage.setItem(SHEET_STORAGE_KEY, k); } catch { /* noop */ } }
  };
  const close = () => setSheet(null);

  // Restore last sheet chip in mobile-friendly quick access
  useEffect(() => { /* lastSheet is available for UI hint via title */ }, [lastSheet]);

  const navButton = (key: Exclude<SheetKey, null>, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const active = sheet === key;
    const wasLast = !active && lastSheet === key;
    return (
      <Button
        key={key}
        onClick={() => open(key)}
        variant="ghost"
        aria-current={active ? 'page' : undefined}
        title={wasLast ? `${label} (last opened)` : label}
        className={cn(
          "h-8 px-2.5 text-xs font-display tracking-wide relative",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          active && "text-primary bg-primary/10",
          wasLast && "text-foreground/90 ring-1 ring-primary/25",
        )}
      >
        <Icon className="h-3.5 w-3.5 mr-1.5" /> {label}
        {active && (
          <span aria-hidden className="absolute left-1 right-1 -bottom-[7px] h-0.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
        )}
      </Button>
    );
  };

  const StrategiesMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Active strategies menu"
          className={cn(
            "h-8 px-2.5 text-xs font-display tracking-wide",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          )}
        >
          <Layers className="h-3.5 w-3.5 mr-1.5" />
          Strategies
          <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">
            {strategies.filter(s => s.active).length}/{strategies.length}
          </span>
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Active Strategies
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {strategies.map(s => (
          <DropdownMenuItem key={s.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${s.active && isRunning ? 'bg-primary animate-pulse' : s.active ? 'bg-primary/40' : 'bg-muted-foreground'}`} />
              <span className="text-foreground">{s.label}</span>
            </span>
            <span className={`text-[9px] font-display uppercase tracking-widest ${s.active ? 'text-primary' : 'text-muted-foreground'}`}>
              {s.active ? (isRunning ? 'Live' : 'Armed') : 'Off'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-3 md:px-5 h-12 border-b border-border/50">
          {/* Mobile menu — Popover gives us built-in focus trap + escape + outside click */}
          <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileOpen}
              >
                <Menu className="h-4 w-4" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-64 p-2 md:hidden"
              role="menu"
              aria-label="Primary navigation"
            >
              <ul className="flex flex-col gap-1">
                {NAV_ITEMS.map(({ key, label, Icon }) => {
                  const active = sheet === key;
                  return (
                    <li key={key} role="none">
                      <Button
                        role="menuitem"
                        onClick={() => open(key)}
                        variant="ghost"
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          "w-full justify-start h-9 text-xs font-display tracking-wide",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          active && "text-primary bg-primary/10 border-l-2 border-primary",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 mr-2" /> {label}
                      </Button>
                    </li>
                  );
                })}
                <li className="pt-1 border-t border-border/40 mt-1">{StrategiesMenu}</li>
              </ul>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isRunning ? 'bg-primary animate-pulse-glow' : 'bg-muted-foreground'}`} />
            <span className="font-display text-sm font-semibold text-foreground tracking-wide">
              Neural Sentinel
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <span className="text-[10px] text-muted-foreground tracking-widest uppercase hidden md:inline">
              {isRunning ? 'LIVE' : 'OFFLINE'}
            </span>
            <Button
              onClick={isRunning ? onStop : onStart}
              variant={isRunning ? 'destructive' : 'default'}
              size="sm"
              aria-label={isRunning ? 'Stop the bot' : 'Start the bot'}
              className="font-display tracking-wide h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {isRunning ? '■ STOP' : '▶ START'}
            </Button>
            <AlertsBell
              alerts={alerts.items}
              unread={alerts.unread}
              open={alerts.open}
              setOpen={alerts.setOpen}
              clear={alerts.clear}
              markRead={alerts.markRead}
              markAllRead={alerts.markAllRead}
              rules={alerts.rules}
              suppressed={alerts.suppressed}
              clearSuppressed={alerts.clearSuppressed}
            />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sign out"
              onClick={() => supabase.auth.signOut()}
              className="font-display tracking-wide h-8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              ⏻ SIGN OUT
            </Button>
          </div>
        </div>

        {/* Second bar (desktop) */}
        <nav
          aria-label="Primary"
          className="hidden md:flex items-center px-3 md:px-5 h-11 overflow-x-auto"
        >
          <div className="flex items-center gap-1 flex-wrap">
            {NAV_ITEMS.map(n => navButton(n.key, n.label, n.Icon))}
            {StrategiesMenu}
          </div>
        </nav>
      </header>

      <Sheet open={sheet === 'settings'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">Trade Settings</SheetTitle>
            <SheetDescription className="text-xs">
              Tune entry/exit windows, position sizing, and risk caps. Changes are confirmed and audited.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {tradeSettings ? (
              <TradeSettingsPanel initial={tradeSettings} onApply={applyTradeSettings} />
            ) : (
              <p className="text-xs text-muted-foreground">Start the bot to load live settings.</p>
            )}
            <SettingsAuditPanel refreshKey={auditTick} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'ml'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">ML Insights</SheetTitle>
            <SheetDescription className="text-xs">
              Aggregate confidence, driver weights, and per-strategy win-rate deltas.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <MLInsightsPanel insights={mlInsights} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'risk'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">Risk Management</SheetTitle>
            <SheetDescription className="text-xs">
              Drawdown, daily loss, and position exposure with hard caps.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <RiskDashboardPanel
              metrics={metrics}
              initialCapital={initialCapital}
              maxDrawdownLimit={maxDrawdownLimit}
              dailyLossLimit={dailyLossLimit}
              isRunning={isRunning}
              onEmergencyStop={onStop}
            />
            <DrawdownGuardPanel currentDrawdown={metrics.maxDrawdown} />
            <DrawdownIncidentsPanel />

          </div>

        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'backtest'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">Strategy Backtest</SheetTitle>
            <SheetDescription className="text-xs">
              Simulate strategies against synthetic markets — optionally with live dashboard settings.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <BacktestPanel liveSettings={tradeSettings} initialCapital={initialCapital} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'rans'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">RANS · Regime-Adaptive Scaler</SheetTitle>
            <SheetDescription className="text-xs">
              Proprietary formula: dynamic weighting · structural arbitrage · 30-day temporal positioning.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <RansPanel
              plan={ransPlan}
              capital={ransCapital}
              realized={ransRealized}
              history={ransHistory}
              thresholds={ransThresholds}
              weightsAll={ransWeightsAll}
              diagnostics={ransDiagnostics}
              killSwitch={ransKillSwitch}
              onApplyThresholds={onApplyRansThresholds}
              onApplyWeights={onApplyRansWeights}
              onToggleKillSwitch={onToggleRansKillSwitch}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'arb'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">Multi-Market Arbitrage &amp; PolySwarm</SheetTitle>
            <SheetDescription className="text-xs">
              Mutually exclusive / dependent / combinatorial arbitrage plus 50-agent swarm consensus.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ArbSwarmPanel
              signals={arbSignals}
              executed={arbExecuted}
              realized={arbRealized}
              swarmSignals={swarmSignals}
              swarmEvents={swarmEvents}
              agentCount={swarmAgentCount}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheet === 'defense'} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display tracking-wide">Defense — Nonce Race &amp; MEV Shield</SheetTitle>
            <SheetDescription className="text-xs">
              Attack detection, ghost-fill screening, manipulation alerts, blacklist and counter-exploit P&amp;L.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <DefensePanel />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default AppNavbar;
