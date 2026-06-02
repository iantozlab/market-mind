import React, { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { MarketRegime, RegimeWeights, RansThresholds } from '@/lib/rans-engine';

interface Props {
  thresholds: RansThresholds;
  currentRegime: MarketRegime | null;
  weightsAll: Record<MarketRegime, RegimeWeights>;
  onApplyThresholds: (p: Partial<RansThresholds>) => void;
  onApplyWeights: (regime: MarketRegime, w: Partial<RegimeWeights>) => void;
}

const RansControlsPanel: React.FC<Props> = ({
  thresholds, currentRegime, weightsAll, onApplyThresholds, onApplyWeights,
}) => {
  const [t, setT] = useState<RansThresholds>(thresholds);
  const regime = currentRegime ?? 'mean_reverting';
  const wInit = weightsAll[regime];
  const [w, setW] = useState<RegimeWeights>(wInit);

  React.useEffect(() => { setT(thresholds); }, [thresholds.highVolatility, thresholds.lowVolatility, thresholds.momentumPersistence, thresholds.eventVolumeSpike, thresholds.minArbConfidence]);
  React.useEffect(() => { setW(weightsAll[regime]); }, [regime, weightsAll]);

  const applyT = () => {
    onApplyThresholds(t);
    toast.success('RANS thresholds applied live');
  };
  const applyW = () => {
    onApplyWeights(regime, w);
    toast.success(`RANS weights applied for ${regime.replace('_', ' ')}`);
  };

  const Row = ({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className="font-mono text-foreground">{fmt(value)}</span></div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-background/40 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Detection Thresholds (live)</div>
        <Row label="High Volatility ≥" value={t.highVolatility} min={0.005} max={0.1} step={0.001}
          fmt={(v) => v.toFixed(3)} onChange={(v) => setT({ ...t, highVolatility: v })} />
        <Row label="Low Volatility ≤" value={t.lowVolatility} min={0.001} max={0.05} step={0.001}
          fmt={(v) => v.toFixed(3)} onChange={(v) => setT({ ...t, lowVolatility: v })} />
        <Row label="Momentum Persistence ≥" value={t.momentumPersistence} min={0.3} max={0.95} step={0.01}
          fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => setT({ ...t, momentumPersistence: v })} />
        <Row label="Event Volume Spike ×" value={t.eventVolumeSpike} min={1.2} max={8} step={0.1}
          fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => setT({ ...t, eventVolumeSpike: v })} />
        <Row label="Arb Confidence Cutoff" value={t.minArbConfidence} min={0.1} max={0.95} step={0.01}
          fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => setT({ ...t, minArbConfidence: v })} />
        <Button size="sm" onClick={applyT} className="w-full font-display tracking-wide">Apply Thresholds</Button>
      </div>

      <div className="rounded border border-border bg-background/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Weights · {regime.replace('_', ' ')}</div>
          <div className="text-[10px] font-mono text-muted-foreground">auto-normalized</div>
        </div>
        <Row label="α Directional" value={w.directional} min={0} max={1} step={0.01}
          fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => setW({ ...w, directional: v })} />
        <Row label="β Arbitrage" value={w.arbitrage} min={0} max={1} step={0.01}
          fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => setW({ ...w, arbitrage: v })} />
        <Row label="γ Temporal" value={w.temporal} min={0} max={1} step={0.01}
          fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => setW({ ...w, temporal: v })} />
        <Button size="sm" onClick={applyW} className="w-full font-display tracking-wide">Apply Weights for {regime.replace('_', ' ').toUpperCase()}</Button>
      </div>
    </div>
  );
};

export default RansControlsPanel;
