import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Trash2, Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getDrawdownIncidents, subscribeDrawdownIncidents, clearDrawdownIncidents,
  drawdownIncidentsToCsv, type DrawdownIncident,
} from '@/lib/drawdown-incidents';

function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const DrawdownIncidentsPanel: React.FC = () => {
  const [rows, setRows] = useState<DrawdownIncident[]>(() => getDrawdownIncidents());
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeDrawdownIncidents(setRows), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Drawdown Incident Timeline
        </h3>
        <span className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!rows.length}
          aria-label="Export drawdown incidents CSV"
          onClick={() => download(`drawdown-incidents-${Date.now()}.csv`, drawdownIncidentsToCsv(rows))}>
          <Download className="h-3 w-3 mr-1" aria-hidden />CSV
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!rows.length}
          aria-label="Clear drawdown incidents" onClick={() => clearDrawdownIncidents()}>
          <Trash2 className="h-3 w-3 mr-1" aria-hidden />Clear
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No guard breaches recorded. Each cooldown will be logged here with its confirmation count and the smoothing settings in force.
        </p>
      ) : (
        <ol className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {rows.map(r => {
            const active = r.cooldownEnd > now;
            const remaining = Math.max(0, Math.ceil((r.cooldownEnd - now) / 1000));
            return (
              <li key={r.id} className="rounded-md border border-border/60 p-2 text-[11px] font-mono">
                <div className="flex flex-wrap items-center gap-2">
                  <Snowflake className={`h-3 w-3 ${active ? 'text-info animate-pulse' : 'text-muted-foreground'}`} aria-hidden />
                  <Badge variant={r.reason === 'max-drawdown' ? 'destructive' : 'secondary'} className="text-[9px]">{r.reason}</Badge>
                  <span className="text-muted-foreground">{new Date(r.cooldownStart).toLocaleString()}</span>
                  <span className="flex-1" />
                  {active
                    ? <span className="text-info">cooling · {Math.floor(remaining / 60)}m {remaining % 60}s left</span>
                    : <span className="text-muted-foreground">resumed {new Date(r.cooldownEnd).toLocaleTimeString()}</span>}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                  <p>breach start: <span className="text-muted-foreground">{new Date(r.breachStartTs).toLocaleTimeString()}</span></p>
                  <p>confirmations: <span className="text-warning">{r.confirmations}/{r.breachTicks}</span></p>
                  <p>tick: <span className="text-muted-foreground">{r.tick}</span></p>
                  <p>drawdown at trip: <span className="text-destructive">{pct(r.drawdownAtTrip)}</span></p>
                  <p>cap: <span className="text-info">{pct(r.maxDrawdownPct)}</span></p>
                  <p>smoothing window: <span className="text-info">{r.smoothingWindow} ticks</span></p>
                  <p>resume buffer: <span className="text-info">{pct(r.resumeBufferPct)}</span></p>
                  <p>re-armed at: <span className="text-primary">{pct(r.resumeLevel)}</span></p>
                  <p>cooldown: <span className="text-muted-foreground">{r.cooldownMinutes}m</span></p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export default DrawdownIncidentsPanel;
