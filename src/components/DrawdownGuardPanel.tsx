import React, { useEffect, useState } from 'react';
import { Snowflake, RotateCcw, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  getDrawdownGuard, setDrawdownGuard, resetDrawdownGuard, subscribeDrawdownGuard,
  type DrawdownGuardConfig,
} from '@/lib/drawdown-guard';
import type { CooldownStatus } from '@/lib/neural-bot-engine';

interface Props {
  currentDrawdown?: number;
  cooldown?: CooldownStatus | null;
}

const Row: React.FC<{
  label: string; hint: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}> = ({ label, hint, value, min, max, step, format, onChange }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <span className="font-mono text-xs text-foreground">{format(value)}</span>
    </div>
    <Slider
      value={[value]} min={min} max={max} step={step}
      onValueChange={([v]) => onChange(v)}
      aria-label={label}
    />
    <p className="text-[10px] text-muted-foreground">{hint}</p>
  </div>
);

const DrawdownGuardPanel: React.FC<Props> = ({ currentDrawdown = 0, cooldown }) => {
  const [cfg, setCfg] = useState<DrawdownGuardConfig>(() => getDrawdownGuard());
  useEffect(() => subscribeDrawdownGuard(setCfg), []);
  const update = (patch: Partial<DrawdownGuardConfig>) => setCfg(setDrawdownGuard(patch));

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Snowflake className="h-4 w-4 text-info" aria-hidden /> Drawdown Guard
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant={cooldown?.active ? 'destructive' : 'outline'} className="font-mono text-[10px]">
            {cooldown?.active ? `cooling ${Math.ceil((cooldown.remainingSec ?? 0) / 60)}m · ${cooldown.reason}` : 'armed'}
          </Badge>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCfg(resetDrawdownGuard())}
            aria-label="Reset drawdown guard to defaults">
            <RotateCcw className="h-3 w-3 mr-1" aria-hidden />Reset
          </Button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <TrendingDown className="h-3 w-3" aria-hidden />
        smoothed drawdown {(currentDrawdown * 100).toFixed(2)}% / cap {(cfg.maxDrawdownPct * 100).toFixed(1)}%
      </p>

      <Row
        label="Max drawdown" hint="Smoothed equity drawdown that pauses trading."
        value={cfg.maxDrawdownPct} min={0.02} max={0.5} step={0.005}
        format={v => `${(v * 100).toFixed(1)}%`}
        onChange={v => update({ maxDrawdownPct: v })}
      />
      <Row
        label="Cooldown duration" hint="How long the bot pauses once the guard fires."
        value={cfg.cooldownMinutes} min={1} max={120} step={1}
        format={v => `${v} min`}
        onChange={v => update({ cooldownMinutes: v })}
      />
      <Row
        label="Smoothing window" hint="EMA ticks — larger smooths noisy fills, slower to react."
        value={cfg.smoothingWindow} min={1} max={60} step={1}
        format={v => `${v} ticks`}
        onChange={v => update({ smoothingWindow: v })}
      />
      <Row
        label="Breach confirmations" hint="Consecutive breaching ticks required before pausing."
        value={cfg.breachTicks} min={1} max={20} step={1}
        format={v => `${v} ticks`}
        onChange={v => update({ breachTicks: v })}
      />
      <Row
        label="Resume buffer" hint="Guard re-arms this far below the cap so it cannot instantly re-trip."
        value={cfg.resumeBufferPct} min={0} max={0.15} step={0.005}
        format={v => `${(v * 100).toFixed(1)}%`}
        onChange={v => update({ resumeBufferPct: v })}
      />
    </section>
  );
};

export default DrawdownGuardPanel;
