import React, { useState } from 'react';
import {
  Sliders, Brain, Shield, History, Layers, ChevronDown, Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ThemeToggle from './ThemeToggle';
import AlertsBell from './AlertsBell';
import TradeSettingsPanel from './TradeSettingsPanel';
import MLInsightsPanel from './MLInsightsPanel';
import RiskDashboardPanel from './RiskDashboardPanel';
import BacktestPanel from './BacktestPanel';
import SettingsAuditPanel from './SettingsAuditPanel';
import RansPanel from './RansPanel';
import type {
  TradeSettings, MLInsights, BotMetrics, StrategyStatus,
} from '@/lib/neural-bot-engine';
import type { RANSPlan } from '@/lib/rans-engine';
import type { AlertItem } from '@/hooks/useAlertsCenter';

type SheetKey = null | 'settings' | 'ml' | 'risk' | 'backtest' | 'rans';

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

  alerts: {
    items: AlertItem[];
    unread: number;
    open: boolean;
    setOpen: (o: boolean) => void;
    clear: () => void;
  };
}

const navBtn = "h-8 px-2.5 text-xs font-display tracking-wide";

const AppNavbar: React.FC<Props> = ({
  isRunning, onStart, onStop,
  tradeSettings, applyTradeSettings,
  mlInsights, metrics, initialCapital, maxDrawdownLimit, dailyLossLimit,
  strategies, auditTick, alerts,
}) => {
  const [sheet, setSheet] = useState<SheetKey>(null);
  const open = (k: SheetKey) => setSheet(k);
  const close = () => setSheet(null);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-2 px-3 md:px-5 h-12">
          <div className="flex items-center gap-2 mr-2">
            <span className={`h-2 w-2 rounded-full ${isRunning ? 'bg-primary animate-pulse-glow' : 'bg-muted-foreground'}`} />
            <span className="font-display text-sm font-semibold text-foreground tracking-wide hidden sm:inline">
              Neural Sentinel
            </span>
          </div>

          <nav className="flex items-center gap-1 flex-wrap">
            <Button onClick={() => open('settings')} variant="ghost" className={navBtn}>
              <Sliders className="h-3.5 w-3.5 mr-1.5" /> Trade Settings
            </Button>
            <Button onClick={() => open('ml')} variant="ghost" className={navBtn}>
              <Brain className="h-3.5 w-3.5 mr-1.5" /> ML Insights
            </Button>
            <Button onClick={() => open('risk')} variant="ghost" className={navBtn}>
              <Shield className="h-3.5 w-3.5 mr-1.5" /> Risk
            </Button>
            <Button onClick={() => open('backtest')} variant="ghost" className={navBtn}>
              <History className="h-3.5 w-3.5 mr-1.5" /> Backtest
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={navBtn}>
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
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground tracking-widest uppercase hidden md:inline">
              {isRunning ? 'LIVE' : 'OFFLINE'}
            </span>
            <Button
              onClick={isRunning ? onStop : onStart}
              variant={isRunning ? 'destructive' : 'default'}
              size="sm"
              className="font-display tracking-wide h-8"
            >
              {isRunning ? '■ STOP' : '▶ START'}
            </Button>
            <AlertsBell
              alerts={alerts.items}
              unread={alerts.unread}
              open={alerts.open}
              setOpen={alerts.setOpen}
              clear={alerts.clear}
            />
            <ThemeToggle />
          </div>
        </div>
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
          <div className="mt-4">
            <RiskDashboardPanel
              metrics={metrics}
              initialCapital={initialCapital}
              maxDrawdownLimit={maxDrawdownLimit}
              dailyLossLimit={dailyLossLimit}
              isRunning={isRunning}
              onEmergencyStop={onStop}
            />
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
    </>
  );
};

export default AppNavbar;
