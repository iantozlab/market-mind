import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BotMetrics } from '@/lib/neural-bot-engine';
import type { RansThresholds } from '@/lib/rans-engine';

type ProfileName = 'conservative' | 'balanced' | 'aggressive';

const PROFILES: Record<ProfileName, Partial<RansThresholds>> = {
  conservative: { highVolatility: 0.03,  lowVolatility: 0.008, momentumPersistence: 0.80, eventVolumeSpike: 3.5, minArbConfidence: 0.75 },
  balanced:     { highVolatility: 0.05,  lowVolatility: 0.012, momentumPersistence: 0.70, eventVolumeSpike: 2.5, minArbConfidence: 0.60 },
  aggressive:   { highVolatility: 0.08,  lowVolatility: 0.020, momentumPersistence: 0.55, eventVolumeSpike: 1.8, minArbConfidence: 0.45 },
};

const PROFILE_LABEL: Record<ProfileName, string> = {
  conservative: 'arb≥75% · spike 3.5x',
  balanced:     'arb≥60% · spike 2.5x',
  aggressive:   'arb≥45% · spike 1.8x',
};

interface Props {
  metrics: BotMetrics;
  isRunning: boolean;
  onApplyThresholds: (p: Partial<RansThresholds>) => void;
}

/** Automatic meta-regime controller — picks a threshold profile from recent Sharpe/DD. */
const MetaRegimeController: React.FC<Props> = ({ metrics, isRunning, onApplyThresholds }) => {
  const [enabled, setEnabled] = useState(false);
  const [current, setCurrent] = useState<ProfileName>('balanced');
  const [switches, setSwitches] = useState<{ ts: number; to: ProfileName; reason: string }[]>([]);
  const lastSwitch = useRef(0);

  const target: ProfileName = useMemo(() => {
    // reward = sharpe - drawdown penalty
    const reward = metrics.sharpeRatio - metrics.maxDrawdown * 3;
    if (metrics.maxDrawdown > 0.12 || reward < -0.2) return 'conservative';
    if (reward > 0.8 && metrics.maxDrawdown < 0.05) return 'aggressive';
    return 'balanced';
  }, [metrics.sharpeRatio, metrics.maxDrawdown]);

  useEffect(() => {
    if (!enabled || !isRunning) return;
    if (target === current) return;
    // cooldown 60s between switches
    if (Date.now() - lastSwitch.current < 60_000) return;
    lastSwitch.current = Date.now();
    setCurrent(target);
    onApplyThresholds(PROFILES[target]);
    setSwitches(s => [
      { ts: Date.now(), to: target, reason: `sharpe=${metrics.sharpeRatio.toFixed(2)} dd=${(metrics.maxDrawdown * 100).toFixed(1)}%` },
      ...s,
    ].slice(0, 8));
  }, [enabled, isRunning, target, current, metrics.sharpeRatio, metrics.maxDrawdown, onApplyThresholds]);

  const applyManual = (p: ProfileName) => {
    setCurrent(p);
    onApplyThresholds(PROFILES[p]);
    setSwitches(s => [{ ts: Date.now(), to: p, reason: 'manual' }, ...s].slice(0, 8));
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Meta-Regime Controller</h2>
        </div>
        <Button
          size="sm"
          variant={enabled ? 'default' : 'outline'}
          onClick={() => setEnabled(v => !v)}
          className="h-7 text-[10px]"
          aria-pressed={enabled}
        >
          {enabled ? <><Pause className="h-3 w-3 mr-1" /> Auto ON</> : <><Play className="h-3 w-3 mr-1" /> Auto OFF</>}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mb-3">
        Switches RANS threshold profiles from rolling Sharpe / drawdown rewards. Cooldown 60s.
      </p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {(Object.keys(PROFILES) as ProfileName[]).map(p => (
          <button
            key={p}
            onClick={() => applyManual(p)}
            className={`rounded border px-2 py-2 text-left transition-colors ${
              current === p ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
            }`}
            aria-pressed={current === p}
          >
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{p}</div>
            <div className="text-[10px] font-mono text-foreground mt-0.5">
              edge≥{PROFILES[p].minEdgeBps}bps · dd≤{(PROFILES[p].dailyStopLossPct! * 100).toFixed(0)}%
            </div>
          </button>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest">Recent switches</div>
      {switches.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No switches yet.</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {switches.map((s, i) => (
            <li key={i} className="text-[11px] font-mono flex justify-between border-b border-border/30 pb-1">
              <span className="text-foreground">→ {s.to}</span>
              <span className="text-muted-foreground">{s.reason}</span>
              <span className="text-muted-foreground">{new Date(s.ts).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MetaRegimeController;
