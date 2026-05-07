import React, { useEffect, useState } from 'react';
import { ScrollText, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { loadAuditLog, clearAudit, FIELD_LABELS, fmtValue, type AuditEntry } from '@/lib/settings-audit';
import { downloadCSV } from '@/lib/exporters';

interface Props {
  /** Bumped by parent every time a new entry is appended, to trigger reload. */
  refreshKey?: number;
}

const fmtTime = (ts: number) => new Date(ts).toLocaleString();

const SettingsAuditPanel: React.FC<Props> = ({ refreshKey = 0 }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => { setEntries(loadAuditLog()); }, [refreshKey]);

  const clear = () => { clearAudit(); setEntries([]); };

  const exportCSV = () => {
    const rows = entries.flatMap(e => e.changes.map(c => ({
      timestamp: new Date(e.ts).toISOString(),
      actor: e.actor,
      field: FIELD_LABELS[c.field],
      before: fmtValue(c.field, c.before),
      after: fmtValue(c.field, c.after),
    })));
    if (rows.length === 0) return;
    downloadCSV(`settings_audit_${Date.now()}.csv`, rows);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">Trade Settings Audit Log</h2>
          <span className="text-[10px] text-muted-foreground font-mono">({entries.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportCSV} disabled={!entries.length} size="sm" variant="outline" className="h-7 text-[10px]">
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button onClick={clear} disabled={!entries.length} size="sm" variant="outline" className="h-7 text-[10px]">
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        </div>
      </div>

      <ScrollArea className="h-56 pr-2">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No settings changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="rounded border border-border/60 bg-background/40 p-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mb-1">
                  <span>{fmtTime(e.ts)}</span>
                  <span className="uppercase tracking-widest">{e.actor}</span>
                </div>
                <ul className="space-y-0.5">
                  {e.changes.map((c, i) => (
                    <li key={i} className="text-xs flex items-center justify-between gap-2">
                      <span className="text-foreground">{FIELD_LABELS[c.field]}</span>
                      <span className="font-mono">
                        <span className="text-muted-foreground line-through">{fmtValue(c.field, c.before)}</span>
                        <span className="mx-1 text-muted-foreground">→</span>
                        <span className="text-primary">{fmtValue(c.field, c.after)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default SettingsAuditPanel;
