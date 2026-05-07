import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import type { TradeSettings } from '@/lib/neural-bot-engine';
import { type AuditChange, FIELD_LABELS, fmtValue } from '@/lib/settings-audit';

interface Props {
  open: boolean;
  changes: AuditChange[];
  onCancel: () => void;
  onConfirm: () => void;
}

const riskFields = new Set<keyof TradeSettings>([
  'kellyFraction', 'maxPositionPct', 'stopLossPct', 'takeProfitPct', 'maxDailyLoss', 'maxDrawdown',
]);

const SettingsConfirmDialog: React.FC<Props> = ({ open, changes, onCancel, onConfirm }) => {
  const hasRisk = changes.some(c => riskFields.has(c.field));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-wide">Confirm trade settings update</DialogTitle>
          <DialogDescription className="text-xs">
            Review the impact before applying. Changes take effect immediately on the running engine.
          </DialogDescription>
        </DialogHeader>

        {hasRisk && (
          <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>You are modifying risk caps. New entries will be gated by the updated limits.</span>
          </div>
        )}

        <div className="rounded border border-border divide-y divide-border max-h-72 overflow-y-auto">
          {changes.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No changes detected.</div>
          ) : changes.map((c) => (
            <div key={c.field} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-display">{FIELD_LABELS[c.field]}</div>
                <div className="font-mono text-muted-foreground line-through">{fmtValue(c.field, c.before)}</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <div className={`font-mono text-right ${riskFields.has(c.field) ? 'text-warning' : 'text-primary'}`}>
                {fmtValue(c.field, c.after)}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm} disabled={changes.length === 0}>Apply Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsConfirmDialog;
