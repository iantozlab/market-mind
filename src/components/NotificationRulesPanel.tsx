import React from 'react';
import { BellOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  getAlertRules, setAlertRules, resetAlertRules, KNOWN_ALERT_STRATEGIES, type AlertRules,
} from '@/lib/alert-rules';

interface Props {
  rules: AlertRules;
  suppressed: number;
  clearSuppressed: () => void;
}

const SNOOZE = [
  ['5m', 5 * 60e3],
  ['30m', 30 * 60e3],
  ['2h', 2 * 3600e3],
] as [string, number][];

const NotificationRulesPanel: React.FC<Props> = ({ rules, suppressed, clearSuppressed }) => {
  const update = (patch: Partial<AlertRules>) => setAlertRules(patch);
  const snoozedFor = Math.max(0, rules.muteUntil - Date.now());

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-display tracking-wide">
          <SlidersHorizontal className="h-3.5 w-3.5 text-primary" aria-hidden /> Notification rules
        </span>
        <Button
          size="sm" variant="ghost" className="h-6 text-[10px]"
          onClick={() => { resetAlertRules(); }} aria-label="Reset notification rules"
        >
          <RotateCcw className="h-3 w-3 mr-1" aria-hidden /> Reset
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
        <div>
          <p className="font-medium">Mute all alerts</p>
          <p className="text-[10px] text-muted-foreground">
            {snoozedFor > 0 ? `Snoozed for ${Math.ceil(snoozedFor / 60000)}m` : 'Nothing reaches the bell while muted'}
          </p>
        </div>
        <Switch checked={rules.muted} onCheckedChange={v => update({ muted: v })} aria-label="Mute all alerts" />
      </div>

      <div className="flex items-center gap-1.5">
        <BellOff className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className="text-[10px] text-muted-foreground mr-1">Snooze</span>
        {SNOOZE.map(([lbl, ms]) => (
          <Button
            key={lbl} size="sm" variant="outline" className="h-6 text-[10px]"
            onClick={() => update({ muteUntil: Date.now() + ms })}
            aria-label={`Snooze alerts for ${lbl}`}
          >{lbl}</Button>
        ))}
        {rules.muteUntil > Date.now() && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => update({ muteUntil: 0 })}>
            Cancel
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Min severity</Label>
          <select
            value={rules.minSeverity}
            onChange={e => update({ minSeverity: e.target.value as AlertRules['minSeverity'] })}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px] font-mono"
            aria-label="Minimum alert severity"
          >
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Max / min</Label>
          <Input
            type="number" min={0} value={rules.maxPerMinute}
            onChange={e => update({ maxPerMinute: Math.max(0, Number(e.target.value)) })}
            className="h-7 font-mono text-[11px]" aria-label="Maximum alerts per minute"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Dedupe (s)</Label>
          <Input
            type="number" min={0} value={rules.dedupeWindowSec}
            onChange={e => update({ dedupeWindowSec: Math.max(0, Number(e.target.value)) })}
            className="h-7 font-mono text-[11px]" aria-label="Duplicate suppression window in seconds"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Per-strategy alerts</p>
        <ul className="space-y-1">
          {KNOWN_ALERT_STRATEGIES.map(s => (
            <li key={s} className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] truncate">{s}</span>
              <Switch
                checked={rules.strategies[s] !== false}
                onCheckedChange={v => update({ strategies: { [s]: v } })}
                aria-label={`Toggle alerts for ${s}`}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-2">
        <Badge variant="outline" className="font-mono text-[10px]">{suppressed} suppressed</Badge>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={clearSuppressed} disabled={!suppressed}>
          Reset counter
        </Button>
      </div>
    </div>
  );
};

export default NotificationRulesPanel;
export { getAlertRules };
