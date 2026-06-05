import React from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, ShieldOff, ShieldCheck } from 'lucide-react';
import { downloadCSV, downloadPDF } from '@/lib/exporters';
import { toast } from 'sonner';
import type { RANSPlan, MarketRegime, RegimeWeights, RansThresholds } from '@/lib/rans-engine';
import { RANS_PARAMS } from '@/lib/rans-engine';
import type { RansHistoryEntry, RansDiagnostics } from '@/lib/neural-bot-engine';
import RansControlsPanel from './RansControlsPanel';
import RegimeTimelineChart from './RegimeTimelineChart';
import RansComparePanel from './RansComparePanel';
import RansDiagnosticsPanel from './RansDiagnosticsPanel';

interface Props {
  plan: RANSPlan | null;
  capital: number;
  realized: number;
  history: RansHistoryEntry[];
  thresholds: RansThresholds;
  weightsAll: Record<MarketRegime, RegimeWeights>;
  diagnostics: RansDiagnostics | null;
  killSwitch: boolean;
  onApplyThresholds: (p: Partial<RansThresholds>) => void;
  onApplyWeights: (regime: MarketRegime, w: Partial<RegimeWeights>) => void;
  onToggleKillSwitch: (on: boolean) => void;
}

const regimeTone: Record<string, string> = {
  trending: 'text-info border-info/40 bg-info/5',
  mean_reverting: 'text-primary border-primary/40 bg-primary/5',
  high_volatility: 'text-destructive border-destructive/40 bg-destructive/5',
  low_volatility: 'text-accent border-accent/40 bg-accent/5',
  event_driven: 'text-warning border-warning/40 bg-warning/5',
};

const phaseTone: Record<string, string> = {
  entry: 'text-primary',
  hold: 'text-info',
  exit: 'text-accent',
  danger: 'text-destructive',
  idle: 'text-muted-foreground',
};

const exportCsv = (history: RansHistoryEntry[]) => {
  if (history.length === 0) { toast.error('No RANS history yet'); return; }
  downloadCSV(`rans-log-${Date.now()}.csv`, history.map(h => ({
    timestamp: new Date(h.ts).toISOString(),
    regime: h.regime,
    regime_changed: h.regimeChanged ? 'YES' : '',
    regime_confidence: h.regimeConfidence.toFixed(3),
    weight_directional: h.directional.toFixed(3),
    weight_arbitrage: h.arbitrage.toFixed(3),
    weight_temporal: h.temporal.toFixed(3),
    arb_count: h.arbCount,
    avg_arb_confidence: h.avgArbConfidence.toFixed(3),
    realized_arb_profit: h.realizedArbProfit.toFixed(4),
    expected_daily_return: h.expectedDailyReturn.toFixed(4),
    top_arb_type: h.topArbType ?? '',
    top_arb_market: h.topArbMarket ?? '',
  })));
  toast.success('RANS log exported');
};

const exportPdf = (history: RansHistoryEntry[]) => {
  if (history.length === 0) { toast.error('No RANS history yet'); return; }
  const totalRealized = history.reduce((s, h) => s + h.realizedArbProfit, 0);
  const changes = history.filter(h => h.regimeChanged).length;
  downloadPDF(
    `rans-log-${Date.now()}.pdf`,
    'RANS — Regime-Adaptive Scaler Log',
    ['Time', 'Regime', 'Δ', 'Conf', 'α', 'β', 'γ', 'Arb#', 'AvgArbConf', 'Realized', 'TopArb'],
    history.slice(-200).map(h => [
      new Date(h.ts).toLocaleTimeString(),
      h.regime,
      h.regimeChanged ? '↻' : '',
      `${(h.regimeConfidence * 100).toFixed(0)}%`,
      `${(h.directional * 100).toFixed(0)}%`,
      `${(h.arbitrage * 100).toFixed(0)}%`,
      `${(h.temporal * 100).toFixed(0)}%`,
      h.arbCount,
      `${(h.avgArbConfidence * 100).toFixed(0)}%`,
      `$${h.realizedArbProfit.toFixed(2)}`,
      (h.topArbMarket ?? '').slice(0, 24),
    ]),
    {
      'Total ticks': history.length,
      'Regime changes': changes,
      'Total realized arb profit': `$${totalRealized.toFixed(2)}`,
      'Latest regime': history[history.length - 1]?.regime ?? '—',
    },
  );
  toast.success('RANS PDF exported');
};

const RansPanel: React.FC<Props> = ({
  plan, capital, realized, history,
  thresholds, weightsAll, onApplyThresholds, onApplyWeights,
  diagnostics, killSwitch, onToggleKillSwitch,
}) => {
  // Auto-rerun key for the comparison panel — recomputes whenever thresholds or any
  // regime weights change so the user can see RANS vs baseline side-by-side immediately.
  const autoRerunKey = JSON.stringify({ t: thresholds, w: weightsAll });

  const KillSwitchBar = (
    <div className={`rounded-lg border px-3 py-2 flex items-center justify-between ${
      killSwitch ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-background/40'
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        {killSwitch
          ? <ShieldOff className="h-4 w-4 text-destructive shrink-0" />
          : <ShieldCheck className="h-4 w-4 text-primary shrink-0" />}
        <div className="min-w-0">
          <div className={`text-[11px] font-display tracking-wide ${killSwitch ? 'text-destructive' : 'text-foreground'}`}>
            {killSwitch ? 'KILL SWITCH ENGAGED — Baseline trading only' : 'RANS scaling active'}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {killSwitch
              ? 'Regime weighting + arbitrage capture disabled. Click to resume.'
              : 'Auto-engages on critical alerts. Click to disable scaling immediately.'}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant={killSwitch ? 'default' : 'destructive'}
        className="h-7 px-2 text-xs font-display tracking-wide"
        onClick={() => onToggleKillSwitch(!killSwitch)}
      >
        {killSwitch ? 'Resume RANS' : 'Kill RANS'}
      </Button>
    </div>
  );

  if (!plan) {
    return (
      <div className="space-y-3">
        {KillSwitchBar}
        <RansDiagnosticsPanel dx={diagnostics} />
        <p className="text-xs text-muted-foreground">
          Start the bot to activate the RANS execution engine.
        </p>
        <div className="rounded border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
          Once active, RANS will route realized arbitrage profit directly into bot P&L and dynamically reweight directional / arbitrage / temporal strategies based on the detected market regime.
        </div>
      </div>
    );
  }

  const tone = regimeTone[plan.regime] ?? 'text-foreground border-border';
  const w = plan.weights;

  return (
    <div className="space-y-4">
      {KillSwitchBar}

      <RansDiagnosticsPanel dx={diagnostics} />


      {/* Header / regime */}
      <div className={`rounded-lg border px-4 py-3 ${tone}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest opacity-70">Current Regime</div>
            <div className="font-display text-xl font-bold tracking-wide">
              {plan.regime.replace('_', ' ').toUpperCase()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest opacity-70">Confidence</div>
            <div className="font-mono text-lg">{(plan.regimeConfidence * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* Weights */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Dynamic Strategy Weights · α / β / γ
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Directional', value: w.directional, tone: 'bg-info' },
            { label: 'Arbitrage', value: w.arbitrage, tone: 'bg-primary' },
            { label: 'Temporal', value: w.temporal, tone: 'bg-accent' },
          ].map(s => (
            <div key={s.label} className="rounded border border-border bg-background/40 p-2">
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
              <div className="font-display text-2xl text-foreground">{Math.round(s.value * 100)}%</div>
              <div className="w-full h-1.5 bg-muted/40 rounded overflow-hidden mt-1">
                <div className={`h-full ${s.tone}`} style={{ width: `${s.value * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Capital / returns */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">RANS Capital</div>
          <div className="font-mono text-sm text-foreground">${capital.toFixed(0)}</div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Realized Arb</div>
          <div className={`font-mono text-sm ${realized >= 0 ? 'text-primary' : 'text-destructive'}`}>
            ${realized.toFixed(2)}
          </div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="text-[10px] text-muted-foreground">Exp Daily Return</div>
          <div className="font-mono text-sm text-accent">{(plan.expectedDailyReturn * 100).toFixed(2)}%</div>
        </div>
      </div>

      {/* Regime timeline + weights chart */}
      <RegimeTimelineChart history={history} />

      {/* Live controls */}
      <RansControlsPanel
        thresholds={thresholds}
        currentRegime={plan.regime}
        weightsAll={weightsAll}
        onApplyThresholds={onApplyThresholds}
        onApplyWeights={onApplyWeights}
      />

      {/* Arbitrage signals */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center justify-between">
          <span>Structural Arbitrage · {plan.arbitrageSignals.length} live · avg conf {(plan.avgArbConfidence * 100).toFixed(0)}%</span>
          {plan.avgArbConfidence > 0 && plan.avgArbConfidence < RANS_PARAMS.MIN_ARB_CONFIDENCE && (
            <span className="text-warning normal-case tracking-normal">below cutoff</span>
          )}
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto terminal-scrollbar">
          {plan.arbitrageSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No arbitrage opportunities this tick.</p>
          ) : plan.arbitrageSignals.map((a, i) => (
            <div key={i} className="rounded border border-border bg-background/40 px-2 py-1.5 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display text-foreground truncate">
                  {a.type} · <span className="text-muted-foreground">{a.marketSlug ?? a.marketId.slice(0, 10)}</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {a.action} · req ${a.requiredCapital.toFixed(0)} · conf {(a.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-primary font-mono">+{(a.profitGuaranteed * 100).toFixed(2)}%</div>
                <div className="text-[10px] font-mono text-muted-foreground">est ${a.expectedReturn.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Temporal windows */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          30-Day Rule · Temporal Windows
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto terminal-scrollbar">
          {plan.temporalWindows.map(win => (
            <div key={win.marketId} className="rounded border border-border bg-background/40 px-2 py-1.5 text-[11px] flex items-center justify-between">
              <span className="font-mono text-muted-foreground truncate">{win.marketId.slice(0, 10)}</span>
              <span className={`font-display uppercase tracking-wide ${phaseTone[win.phase]}`}>
                {win.phase} · {win.daysToExpiry.toFixed(1)}d
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Compare */}
      <RansComparePanel ransPlan={plan} initialCapital={capital} autoRerunKey={autoRerunKey} diagnostics={diagnostics} />

      {/* Export */}
      <div className="rounded border border-border bg-background/40 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">RANS Log Export</div>
            <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{history.length} ticks recorded</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportCsv(history)} className="h-7 text-xs">
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportPdf(history)} className="h-7 text-xs">
              <FileText className="h-3 w-3 mr-1" /> PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Formula */}
      <div className="rounded border border-border bg-background/40 p-3 text-[11px] font-mono text-muted-foreground">
        <div className="mb-1 text-foreground">RANS Edge =</div>
        <div>α({Math.round(w.directional * 100)}%)·Directional + β({Math.round(w.arbitrage * 100)}%)·Arb + γ({Math.round(w.temporal * 100)}%)·Temporal</div>
        <div className="mt-1 text-[10px]">
          Targets: WR ≥ {(RANS_PARAMS.TARGET_WIN_RATE * 100).toFixed(0)}% · Sharpe ≥ {RANS_PARAMS.SHARPE_TARGET} · Max DD ≤ {(RANS_PARAMS.MAX_DRAWDOWN * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
};

export default RansPanel;
