import React, { useEffect, useState } from 'react';
import { Settings2, Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TradeSettings } from '@/lib/neural-bot-engine';
import SettingsConfirmDialog from './SettingsConfirmDialog';
import { diffSettings, type AuditChange } from '@/lib/settings-audit';

interface Props {
  initial: TradeSettings;
  onApply: (s: Partial<TradeSettings>) => void;
}

const Field: React.FC<{
  label: string; value: number; suffix?: string; step?: number; min?: number; max?: number;
  onChange: (v: number) => void;
}> = ({ label, value, suffix, step = 1, min, max, onChange }) => (
  <div className="space-y-1">
    <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-display">{label}</label>
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))}
        className="h-8 w-full bg-background border border-border rounded px-2 text-xs font-mono text-foreground"
      />
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  </div>
);

const TradeSettingsPanel: React.FC<Props> = ({ initial, onApply }) => {
  const [s, setS] = useState<TradeSettings>(initial);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<AuditChange[]>([]);

  useEffect(() => { setS(initial); }, [initial.entryWindowMs, initial.exitWindowMs]);

  const upd = <K extends keyof TradeSettings>(k: K, v: TradeSettings[K]) => {
    setS(prev => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const requestApply = () => {
    setPendingDiff(diffSettings(initial, s));
    setConfirmOpen(true);
  };
  const confirmApply = () => {
    onApply(s);
    setConfirmOpen(false);
    setDirty(false);
  };
  const reset = () => { setS(initial); setDirty(false); };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">Trade Settings</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={reset} disabled={!dirty} size="sm" variant="outline" className="h-7 text-xs">
            <RotateCcw className="h-3 w-3 mr-1" /> Reset
          </Button>
          <Button onClick={apply} disabled={!dirty} size="sm" className="h-7 text-xs">
            <Save className="h-3 w-3 mr-1" /> Apply
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Entry Window" value={s.entryWindowMs} suffix="ms" min={100} step={100}
               onChange={v => upd('entryWindowMs', v)} />
        <Field label="Exit Window" value={s.exitWindowMs} suffix="ms" min={1000} step={500}
               onChange={v => upd('exitWindowMs', v)} />
        <Field label="Kelly Fraction" value={Number((s.kellyFraction * 100).toFixed(2))} suffix="%" min={1} max={100} step={0.5}
               onChange={v => upd('kellyFraction', v / 100)} />
        <Field label="Max Position" value={Number((s.maxPositionPct * 100).toFixed(2))} suffix="% cap" min={1} max={50} step={0.5}
               onChange={v => upd('maxPositionPct', v / 100)} />
        <Field label="Stop Loss" value={Number((s.stopLossPct * 100).toFixed(2))} suffix="%" min={1} max={50} step={0.5}
               onChange={v => upd('stopLossPct', v / 100)} />
        <Field label="Take Profit" value={Number((s.takeProfitPct * 100).toFixed(2))} suffix="%" min={1} max={500} step={1}
               onChange={v => upd('takeProfitPct', v / 100)} />
        <Field label="Max Daily Loss" value={s.maxDailyLoss} suffix="$" min={0} step={10}
               onChange={v => upd('maxDailyLoss', v)} />
        <Field label="Max Drawdown" value={Number((s.maxDrawdown * 100).toFixed(2))} suffix="%" min={1} max={80} step={0.5}
               onChange={v => upd('maxDrawdown', v / 100)} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        Changes apply live to the running engine. Risk caps gate new entries; entry/exit windows tune the bot-exhaustion scanner.
      </p>
    </div>
  );
};

export default TradeSettingsPanel;
