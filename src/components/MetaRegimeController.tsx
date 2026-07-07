import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Pause, Play, Settings2 } from 'lucide-react';
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

interface Config {
  ddConservative: number;      // trigger conservative when DD above this
  rewardConservative: number;  // or reward below this
  ddAggressiveMax: number;     // require DD below this for aggressive
  rewardAggressive: number;    // require reward above this
  cooldownSec: number;
  drawdownPenalty: number;     // multiplier on DD in reward calc
}

const CFG_KEY = 'meta_regime_cfg_v1';
const DEFAULT_CFG: Config = {
  ddConservative: 0.12,
  rewardConservative: -0.2,
  ddAggressiveMax: 0.05,
  rewardAggressive: 0.8,
  cooldownSec: 60,
  drawdownPenalty: 3,
};

interface Props {
  metrics: BotMetrics;
  isRunning: boolean;
  onApplyThresholds: (p: Partial<RansThresholds>) => void;
}

const MetaRegimeController: React.FC<Props> = ({ metrics, isRunning, onApplyThresholds }) => {
  const [enabled, setEnabled] = useState(false);
  const [current, setCurrent] = useState<ProfileName>('balanced');
  const [switches, setSwitches] = useState<{ ts: number; to: ProfileName; reason: string }[]>([]);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfg, setCfg] = useState<Config>(() => {
    try { return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return DEFAULT_CFG; }
  });
  const lastSwitch = useRef(0);

  useEffect(() => { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }, [cfg]);

  const target: ProfileName = useMemo(() => {
    const reward = metrics.sharpeRatio - metrics.maxDrawdown * cfg.drawdownPenalty;
    if (metrics.maxDrawdown > cfg.ddConservative || reward < cfg.rewardConservative) return 'conservative';
    if (reward > cfg.rewardAggressive && metrics.maxDrawdown < cfg.ddAggressiveMax) return 'aggressive';
    return 'balanced';
  }, [metrics.sharpeRatio, metrics.maxDrawdown, cfg]);

  useEffect(() => {
    if (!enabled || !isRunning) return;
    if (target === current) return;
    if (Date.now() - lastSwitch.current < cfg.cooldownSec * 1000) return;
    lastSwitch.current = Date.now();
    setCurrent(target);
    onApplyThresholds(PROFILES[target]);
    setSwitches(s => [
      { ts: Date.now(), to: target, reason: `sharpe=${metrics.sharpeRatio.toFixed(2)} dd=${(metrics.maxDrawdown * 100).toFixed(1)}%` },
      ...s,
    ].slice(0, 8));
  }, [enabled, isRunning, target, current, metrics.sharpeRatio, metrics.maxDrawdown, onApplyThresholds, cfg.cooldownSec]);

  const applyManual = (p: ProfileName) => {
    setCurrent(p);
    onApplyThresholds(PROFILES[p]);
    setSwitches(s => [{ ts: Date.now(), to: p, reason: 'manual' }, ...s].slice(0, 8));
  };

  const patchCfg = (patch: Partial<Config>) => setCfg(c => ({ ...c, ...patch }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Meta-Regime Controller</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCfgOpen(v => !v)}
            className="h-7 text-[10px]"
            aria-pressed={cfgOpen}
            aria-label="Meta-regime settings"
          >
            <Settings2 className="h-3 w-3" />
          </Button>
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
      </div>

      <p className="text-[11px] text-muted-foreground mb-3">
        Switches RANS threshold profiles from rolling Sharpe / drawdown rewards. Cooldown {cfg.cooldownSec}s.
      </p>

      {cfgOpen && (
        <div className="mb-3 rounded border border-border bg-background/40 p-3 grid grid-cols-2 gap-2 text-[10px]">
          {([
            ['ddConservative', 'DD → Conservative (>)', 0, 0.5, 0.01, '%'],
            ['rewardConservative', 'Reward → Conservative (<)', -2, 2, 0.05, ''],
            ['ddAggressiveMax', 'DD max for Aggressive (<)', 0, 0.3, 0.005, '%'],
            ['rewardAggressive', 'Reward → Aggressive (>)', 0, 3, 0.05, ''],
            ['drawdownPenalty', 'DD penalty × in reward', 0, 10, 0.1, 'x'],
            ['cooldownSec', 'Cooldown (seconds)', 10, 600, 5, 's'],
          ] as [keyof Config, string, number, number, number, string][]).map(([key, label, min, max, step, suffix]) => (
            <label key={key} className="flex flex-col gap-0.5">
              <span className="uppercase tracking-widest text-muted-foreground">{label}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={min} max={max} step={step}
                  value={cfg[key]}
                  onChange={e => patchCfg({ [key]: Number(e.target.value) } as Partial<Config>)}
                  className="accent-primary flex-1"
                  aria-label={label}
                />
                <span className="font-mono text-foreground w-14 text-right">
                  {suffix === '%' ? `${(cfg[key] * 100).toFixed(1)}%` : `${cfg[key]}${suffix}`}
                </span>
              </div>
            </label>
          ))}
          <div className="col-span-2 flex justify-end">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setCfg(DEFAULT_CFG)}>
              Reset defaults
            </Button>
          </div>
        </div>
      )}

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
              {PROFILE_LABEL[p]}
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
