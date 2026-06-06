import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, AlertOctagon, ShieldAlert, Clock, RefreshCw, Bell, Search, ChevronLeft, ChevronRight, Play, Link2, FileJson, FlaskConical, AlertTriangle } from 'lucide-react';
import { downloadCSV } from '@/lib/exporters';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { RansDiagnostics } from '@/lib/neural-bot-engine';
import {
  queryRansDiagEvents, countRansDiagEvents,
  getNotifySettings, setNotifySettings, recordRansDiagEvent, notifyExternal,
  type RansDiagEvent, type RansDiagEventType, type NotifySettings,
} from '@/lib/rans-diag-events';

interface Props {
  dx: RansDiagnostics | null;
}

const fmtMs = (n: number) => `${n.toFixed(1)}ms`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDur = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="rounded border border-border bg-background/40 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className={`font-mono text-sm ${tone ?? 'text-foreground'}`}>{value}</div>
  </div>
);

const EVENT_TYPES: RansDiagEventType[] = ['signal_dropout', 'guardrail_clamp', 'kill_switch', 'kill_switch_resume', 'regime_change', 'guardrail_burst'];
const PAGE_SIZE = 25;

const RansDiagnosticsPanel: React.FC<Props> = ({ dx }) => {
  const [rangeHours, setRangeHours] = useState<number>(24);
  const [typeFilter, setTypeFilter] = useState<RansDiagEventType | 'all'>('all');
  const [regimeFilter, setRegimeFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(0);
  const [events, setEvents] = useState<RansDiagEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedTick, setSelectedTick] = useState<number | null>(null);
  const [notify, setNotify] = useState<NotifySettings>(() => getNotifySettings());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [harnessLog, setHarnessLog] = useState<Array<{ ts: number; kind: string; status: string; payload: any }>>([]);
  const guardrailContainerRef = useRef<HTMLDivElement>(null);
  const deepLinkHandledRef = useRef(false);

  type FallbackBanner = {
    kind: 'tick' | 'event';
    requested: string;
    resolved: number;
    reason: string;
  };
  const [fallbackBanner, setFallbackBanner] = useState<FallbackBanner | null>(null);

  const loadEvents = async () => {
    setLoadingEvents(true);
    const fromIso = new Date(Date.now() - rangeHours * 3_600_000).toISOString();
    const baseQ = {
      fromIso,
      types: typeFilter === 'all' ? undefined : [typeFilter],
      regime: regimeFilter || undefined,
      search: search || undefined,
    };
    const [res, count] = await Promise.all([
      queryRansDiagEvents({ ...baseQ, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      countRansDiagEvents({ fromIso, types: typeFilter === 'all' ? undefined : [typeFilter] }),
    ]);
    setEvents(res);
    setTotalCount(count);
    setLoadingEvents(false);
  };
  useEffect(() => { loadEvents(); /* eslint-disable-next-line */ }, [rangeHours, typeFilter, regimeFilter, page]);
  // Reset page on search/filter changes
  useEffect(() => { setPage(0); /* eslint-disable-next-line */ }, [search, regimeFilter, typeFilter, rangeHours]);

  if (!dx) {
    return (
      <div className="rounded border border-border bg-background/40 p-3 text-xs text-muted-foreground">
        Start the bot to populate RANS diagnostics.
      </div>
    );
  }

  const exportCsv = () => {
    if (dx.tickCount === 0) { toast.error('No diagnostics ticks yet'); return; }
    downloadCSV(`rans-diagnostics-${Date.now()}.csv`, [{
      timestamp: new Date().toISOString(),
      integration_ok: dx.integrationOk ? 'YES' : 'NO',
      kill_switch: dx.killSwitch ? 'ENGAGED' : 'OFF',
      kill_switch_reason: dx.killSwitchReason,
      kill_switch_at: dx.killSwitchAt ? new Date(dx.killSwitchAt).toISOString() : '',
      uptime_ms: dx.uptimeMs,
      tick_count: dx.tickCount,
      last_latency_ms: dx.lastLatencyMs.toFixed(2),
      avg_latency_ms: dx.avgLatencyMs.toFixed(2),
      max_latency_ms: dx.maxLatencyMs.toFixed(2),
      signal_dropouts: dx.signalDropouts,
      dropout_rate: dx.dropoutRate.toFixed(4),
      arb_activations: dx.arbActivations,
      temporal_activations: dx.temporalActivations,
      activation_rate: dx.activationRate.toFixed(4),
      regime_changes: dx.regimeChanges,
      errors: dx.errors,
      last_error: dx.lastError,
      last_error_ts: dx.lastErrorTs ? new Date(dx.lastErrorTs).toISOString() : '',
    }]);
    toast.success('Diagnostics exported');
  };

  const exportSeriesCsv = () => {
    if (dx.latencyHistory.length === 0) { toast.error('No samples yet'); return; }
    const rows = dx.latencyHistory.map((p, i) => ({
      tick: p.tick,
      timestamp: new Date(p.ts).toISOString(),
      latency_ms: p.latencyMs.toFixed(3),
      activation_rate: (dx.activationHistory[i]?.rate ?? 0).toFixed(4),
    }));
    downloadCSV(`rans-diag-series-${Date.now()}.csv`, rows);
    toast.success('Series exported');
  };

  const exportEventsCsv = () => {
    if (events.length === 0) { toast.error('No events on this page'); return; }
    downloadCSV(`rans-diag-events-${Date.now()}.csv`, events.map(e => ({
      created_at: e.created_at ?? '',
      event_type: e.event_type,
      severity: e.severity,
      detail: JSON.stringify(e.detail),
    })));
    toast.success('Events exported');
  };

  const statusTone = dx.integrationOk && !dx.killSwitch
    ? 'text-primary border-primary/40 bg-primary/5'
    : dx.killSwitch
    ? 'text-destructive border-destructive/40 bg-destructive/5'
    : 'text-warning border-warning/40 bg-warning/5';
  const statusText = !dx.integrationOk ? 'OFFLINE' : dx.killSwitch ? 'KILL-SWITCH' : 'HEALTHY';

  const latencyTone = dx.avgLatencyMs > 50 ? 'text-destructive' : dx.avgLatencyMs > 20 ? 'text-warning' : 'text-primary';
  const dropoutTone = dx.dropoutRate > 0.5 ? 'text-destructive' : dx.dropoutRate > 0.25 ? 'text-warning' : 'text-foreground';
  const errorsTone = dx.errors > 0 ? 'text-destructive' : 'text-foreground';

  const latencyChart = useMemo(() =>
    dx.latencyHistory.map(p => ({ tick: p.tick, latency: Number(p.latencyMs.toFixed(2)) })),
  [dx.latencyHistory]);
  const actChart = useMemo(() =>
    dx.activationHistory.map(p => ({ tick: p.tick, rate: Number(p.rate.toFixed(3)) })),
  [dx.activationHistory]);

  // Resolve the tick associated with an event:
  // 1) prefer detail.tick when present, 2) else nearest latencyHistory by ts.
  const resolveEventTick = (e: RansDiagEvent): number | null => {
    const t = (e.detail as any)?.tick;
    if (typeof t === 'number') return t;
    const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
    if (!ts || dx.latencyHistory.length === 0) return null;
    let best = dx.latencyHistory[0];
    let bestDelta = Math.abs(best.ts - ts);
    for (const p of dx.latencyHistory) {
      const d = Math.abs(p.ts - ts);
      if (d < bestDelta) { best = p; bestDelta = d; }
    }
    return best.tick;
  };

  const allTicks = useMemo(() => {
    const s = new Set<number>();
    dx.latencyHistory.forEach(p => s.add(p.tick));
    dx.activationHistory.forEach(p => s.add(p.tick));
    dx.guardrailViolations.forEach(v => s.add(v.tick));
    return Array.from(s).sort((a, b) => a - b);
  }, [dx.latencyHistory, dx.activationHistory, dx.guardrailViolations]);

  const findNearestTick = (target: number): number => {
    if (allTicks.length === 0) return dx.tickCount > 0 ? dx.tickCount : 0;
    let best = allTicks[0];
    let bestDelta = Math.abs(best - target);
    for (const t of allTicks) {
      const d = Math.abs(t - target);
      if (d < bestDelta) { best = t; bestDelta = d; }
    }
    return best;
  };

  const tickExists = (tick: number): boolean => allTicks.includes(tick);

  const replayEvent = (e: RansDiagEvent) => {
    const tick = resolveEventTick(e);
    setSelectedTick(tick);
    if (tick != null && guardrailContainerRef.current) {
      const node = guardrailContainerRef.current.querySelector(`[data-tick="${tick}"]`) as HTMLElement | null;
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // -------- Deep-link: ?diagTick=N or ?diagEventId=<id> --------
  useEffect(() => {
    if (deepLinkHandledRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tickParam = params.get('diagTick');
    const eventIdParam = params.get('diagEventId');
    if (!tickParam && !eventIdParam) return;
    deepLinkHandledRef.current = true;

    const scrollToTick = (tick: number) => {
      setTimeout(() => {
        const node = guardrailContainerRef.current?.querySelector(`[data-tick="${tick}"]`) as HTMLElement | null;
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 250);
    };

    // Resolve tickParam first so it can be reused as a fallback anchor.
    let resolvedTick: number | null = null;
    if (tickParam) {
      const n = Number(tickParam);
      if (!Number.isInteger(n) || n < 0 || !Number.isFinite(n)) {
        resolvedTick = findNearestTick(0);
        setSelectedTick(resolvedTick);
        setFallbackBanner({
          kind: 'tick',
          requested: tickParam,
          resolved: resolvedTick,
          reason: `Invalid tick value "${tickParam}" — must be a non-negative integer.`,
        });
        toast.warning(`Invalid deep-link tick "${tickParam}" — resolved to nearest tick ${resolvedTick}`);
        scrollToTick(resolvedTick);
      } else if (!tickExists(n)) {
        resolvedTick = findNearestTick(n);
        setSelectedTick(resolvedTick);
        setFallbackBanner({
          kind: 'tick',
          requested: String(n),
          resolved: resolvedTick,
          reason: `Tick ${n} not found in current history (${allTicks.length} ticks recorded) — fell back to nearest tick ${resolvedTick}.`,
        });
        toast.warning(`Tick ${n} not found — resolved to nearest tick ${resolvedTick}`);
        scrollToTick(resolvedTick);
      } else {
        resolvedTick = n;
        setSelectedTick(n);
        toast.success(`Deep-link replay: tick ${n}`);
        scrollToTick(n);
      }
    }

    if (eventIdParam) {
      (async () => {
        const all = await queryRansDiagEvents({ limit: 500 });
        const ev = all.find(e => e.id === eventIdParam);
        if (ev) {
          const tick = resolveEventTick(ev);
          if (tick != null && tickExists(tick)) {
            setSelectedTick(tick);
            toast.success(`Deep-link event ${eventIdParam.slice(0, 8)}… → tick ${tick}`);
            scrollToTick(tick);
          } else if (tick != null) {
            const fb = findNearestTick(tick);
            setSelectedTick(fb);
            setFallbackBanner({
              kind: 'event',
              requested: eventIdParam,
              resolved: fb,
              reason: `Event resolved to tick ${tick}, which is absent from current history — fell back to nearest tick ${fb}.`,
            });
            toast.warning(`Event tick ${tick} missing — resolved to nearest tick ${fb}`);
            scrollToTick(fb);
          } else {
            const fb = resolvedTick ?? findNearestTick(dx.tickCount);
            setSelectedTick(fb);
            setFallbackBanner({
              kind: 'event',
              requested: eventIdParam,
              resolved: fb,
              reason: `Event found but has no resolvable tick — fell back to nearest tick ${fb}.`,
            });
            toast.warning(`Event has no tick — resolved to nearest tick ${fb}`);
            scrollToTick(fb);
          }
        } else {
          const fb = resolvedTick ?? findNearestTick(dx.tickCount);
          setSelectedTick(fb);
          setFallbackBanner({
            kind: 'event',
            requested: eventIdParam,
            resolved: fb,
            reason: `Event ID "${eventIdParam}" not found in recent history — fell back to nearest tick ${fb}.`,
          });
          toast.error(`Event not found — resolved to nearest tick ${fb}`);
          scrollToTick(fb);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyDeepLink = (e: RansDiagEvent) => {
    const tick = resolveEventTick(e);
    const url = new URL(window.location.href);
    url.searchParams.set('diagEventId', e.id ?? '');
    if (tick != null) url.searchParams.set('diagTick', String(tick));
    navigator.clipboard?.writeText(url.toString()).then(
      () => toast.success('Replay link copied'),
      () => toast.error('Clipboard blocked'),
    );
  };

  // -------- JSON bundle export for the currently selected replay window --------
  const exportReplayBundle = () => {
    if (selectedTick == null) { toast.error('Select a replay event first'); return; }
    const tick = selectedTick;
    const nearest = <T extends { tick: number }>(arr: T[]): T | null => {
      if (arr.length === 0) return null;
      let best = arr[0]; let bd = Math.abs(best.tick - tick);
      for (const p of arr) { const d = Math.abs(p.tick - tick); if (d < bd) { best = p; bd = d; } }
      return best;
    };
    const win = <T extends { tick: number }>(arr: T[], radius = 15) =>
      arr.filter(p => Math.abs(p.tick - tick) <= radius);

    const bundle = {
      generated_at: new Date().toISOString(),
      app_version: 'rans-diag-bundle/1',
      selected_tick: tick,
      kill_switch: {
        engaged: dx.killSwitch,
        reason: dx.killSwitchReason,
        at: dx.killSwitchAt,
        metrics: dx.killSwitchMetrics,
      },
      summary: {
        uptimeMs: dx.uptimeMs,
        tickCount: dx.tickCount,
        avgLatencyMs: dx.avgLatencyMs,
        maxLatencyMs: dx.maxLatencyMs,
        dropoutRate: dx.dropoutRate,
        activationRate: dx.activationRate,
        regimeChanges: dx.regimeChanges,
      },
      nearest: {
        latency: nearest(dx.latencyHistory),
        activation: nearest(dx.activationHistory),
        guardrail: dx.guardrailViolations.find(v => v.tick === tick) ?? nearest(dx.guardrailViolations),
      },
      window: {
        latency: win(dx.latencyHistory),
        activation: win(dx.activationHistory),
        guardrail: dx.guardrailViolations.filter(v => Math.abs(v.tick - tick) <= 15),
      },
      events_on_page: events.map(e => ({ ...e, _resolvedTick: resolveEventTick(e) })),
      filters: { rangeHours, typeFilter, regimeFilter, search, page },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rans-replay-tick${tick}-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success('Replay JSON bundle exported');
  };

  // -------- Test harness: simulate kill-switch + guardrail-burst --------
  const pushHarness = (kind: string, status: string, payload: any) =>
    setHarnessLog(l => [{ ts: Date.now(), kind, status, payload }, ...l].slice(0, 25));

  const simulateKillSwitch = async () => {
    const payload = {
      reason: 'TEST · simulated critical alert',
      tick: dx.tickCount,
      dailyPnL: -123.45,
      maxDrawdown: 0.18,
      winRate: 0.42,
      simulated: true,
    };
    const ev = { event_type: 'kill_switch' as const, severity: 'critical' as const, detail: payload };
    recordRansDiagEvent(ev);
    pushHarness('kill_switch', 'queued+persisted', payload);
    try {
      await notifyExternal(ev);
      pushHarness('kill_switch', notify.enabled ? `notify dispatched (webhook=${notify.webhookUrl ? 'yes' : 'no'}, email=${notify.email ? 'yes' : 'no'})` : 'notify disabled', payload);
    } catch (err) {
      pushHarness('kill_switch', `notify error: ${(err as Error).message}`, payload);
    }
  };

  const simulateBurst = async () => {
    const burstCount = 4;
    for (let i = 0; i < burstCount; i++) {
      recordRansDiagEvent({
        event_type: 'guardrail_clamp', severity: 'warning',
        detail: { simulated: true, idx: i, regime: 'high_volatility', field: 'alpha', before: 0.9, after: 0.7 },
      });
    }
    const burstPayload = { simulated: true, count: burstCount, windowMs: 10_000, regime: 'high_volatility' };
    const ev = { event_type: 'guardrail_burst' as const, severity: 'warning' as const, detail: burstPayload };
    recordRansDiagEvent(ev);
    pushHarness('guardrail_burst', `${burstCount} clamps + burst persisted`, burstPayload);
    try {
      await notifyExternal(ev);
      // Fire a second burst immediately to verify mailto throttling (30s window).
      await notifyExternal(ev);
      pushHarness('guardrail_burst', 'notify dispatched x2 (email mailto throttled if <30s)', burstPayload);
    } catch (err) {
      pushHarness('guardrail_burst', `notify error: ${(err as Error).message}`, burstPayload);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));


  return (
    <div className="rounded border border-border bg-background/40 p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">RANS Diagnostics</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-display tracking-widest px-2 py-0.5 rounded border ${statusTone}`}>
            {statusText}
          </span>
          <Button size="sm" variant="outline" onClick={() => setNotifyOpen(o => !o)} className="h-7 text-xs">
            <Bell className={`h-3 w-3 mr-1 ${notify.enabled ? 'text-primary' : ''}`} /> Notify
          </Button>
          <Button size="sm" variant="outline" onClick={() => setHarnessOpen(o => !o)} className="h-7 text-xs">
            <FlaskConical className="h-3 w-3 mr-1" /> Test
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} className="h-7 text-xs">
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {notifyOpen && (
        <div className="rounded border border-border bg-background/60 p-2 space-y-1.5 text-[11px]">
          <div className="font-display tracking-wide text-foreground">Notification Hooks</div>
          <div className="text-muted-foreground text-[10px]">Same banner payload (event type, severity, reason, metrics) fires on kill-switch activations and guardrail clamp bursts (≥3 clamps in 10s).</div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={notify.enabled}
                onChange={(e) => setNotify(n => ({ ...n, enabled: e.target.checked }))}
              />
              <span>Enabled</span>
            </label>
            <input
              type="url" placeholder="Webhook URL (Slack/Zapier/own endpoint)"
              value={notify.webhookUrl}
              onChange={(e) => setNotify(n => ({ ...n, webhookUrl: e.target.value }))}
              className="flex-1 min-w-[220px] h-7 bg-background border border-border rounded px-2 font-mono text-[11px]"
            />
            <input
              type="email" placeholder="Email (opens mailto with payload)"
              value={notify.email}
              onChange={(e) => setNotify(n => ({ ...n, email: e.target.value }))}
              className="flex-1 min-w-[180px] h-7 bg-background border border-border rounded px-2 font-mono text-[11px]"
            />
            <Button size="sm" onClick={() => { setNotifySettings(notify); setNotifyOpen(false); toast.success('Notification hooks updated'); }} className="h-7 text-xs">Save</Button>
          </div>
        </div>
      )}

      {/* Kill switch reason banner */}
      {dx.killSwitch && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-destructive font-display tracking-wide">
            <AlertOctagon className="h-3.5 w-3.5" /> Kill switch triggered by
          </div>
          <div className="font-mono text-foreground mt-0.5 break-all">{dx.killSwitchReason || '—'}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {dx.killSwitchAt ? new Date(dx.killSwitchAt).toLocaleString() : '—'}
          </div>
          {Object.keys(dx.killSwitchMetrics).length > 0 && (
            <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-1">
              {Object.entries(dx.killSwitchMetrics).map(([k, v]) => (
                <div key={k} className="rounded border border-destructive/30 bg-background/40 px-1.5 py-0.5">
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className="font-mono text-[11px] text-foreground">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Uptime" value={fmtDur(dx.uptimeMs)} />
        <Stat label="Ticks" value={dx.tickCount} />
        <Stat label="Last Latency" value={fmtMs(dx.lastLatencyMs)} tone={latencyTone} />
        <Stat label="Avg Latency" value={fmtMs(dx.avgLatencyMs)} tone={latencyTone} />
        <Stat label="Max Latency" value={fmtMs(dx.maxLatencyMs)} />
        <Stat label="Activation Rate" value={dx.activationRate.toFixed(2) + '/tick'} />
        <Stat label="Signal Dropouts" value={`${dx.signalDropouts} (${fmtPct(dx.dropoutRate)})`} tone={dropoutTone} />
        <Stat label="Regime Changes" value={dx.regimeChanges} />
        <Stat label="Arb Activations" value={dx.arbActivations} />
        <Stat label="Temporal Activations" value={dx.temporalActivations} />
        <Stat label="Errors" value={dx.errors} tone={errorsTone} />
        <Stat label="Integration" value={dx.integrationOk ? 'WIRED' : 'MISSING'} tone={dx.integrationOk ? 'text-primary' : 'text-destructive'} />
      </div>

      {/* Replay banner */}
      {selectedTick != null && (
        <div className="rounded border border-accent/40 bg-accent/5 px-2 py-1 text-[11px] flex items-center justify-between flex-wrap gap-2">
          <div className="text-accent font-display tracking-wide flex items-center gap-1.5">
            <Play className="h-3 w-3" /> Replaying tick {selectedTick} — highlighted across latency, activation and guardrail samples.
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={exportReplayBundle}>
              <FileJson className="h-3 w-3 mr-1" /> Export Bundle
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('diagTick', String(selectedTick));
              navigator.clipboard?.writeText(url.toString()).then(
                () => toast.success('Replay link copied'),
                () => toast.error('Clipboard blocked'),
              );
            }}>
              <Link2 className="h-3 w-3 mr-1" /> Copy Link
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSelectedTick(null)}>Clear</Button>
          </div>
        </div>
      )}

      {/* Test harness */}
      {harnessOpen && (
        <div className="rounded border border-warning/40 bg-warning/5 p-2 space-y-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-warning font-display tracking-wide">
            <FlaskConical className="h-3.5 w-3.5" /> Notification Test Harness
          </div>
          <div className="text-[10px] text-muted-foreground">
            Fires simulated kill-switch and guardrail-burst events end-to-end (persist → webhook → mailto). Email mailto links are throttled to one per 30s.
            Current hooks: webhook {notify.webhookUrl ? 'set' : 'none'} · email {notify.email ? 'set' : 'none'} · enabled {notify.enabled ? 'YES' : 'NO'}.
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={simulateKillSwitch}>Simulate Kill-Switch</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={simulateBurst}>Simulate Guardrail Burst</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setHarnessLog([])} disabled={harnessLog.length === 0}>Clear log</Button>
          </div>
          {harnessLog.length > 0 && (
            <div className="max-h-40 overflow-y-auto terminal-scrollbar border border-border rounded bg-background/60">
              <table className="w-full text-[10px] font-mono">
                <tbody className="divide-y divide-border/40">
                  {harnessLog.map((l, i) => (
                    <tr key={i}>
                      <td className="px-1.5 py-1 text-muted-foreground whitespace-nowrap">{new Date(l.ts).toLocaleTimeString()}</td>
                      <td className="px-1.5 py-1 text-foreground">{l.kind}</td>
                      <td className="px-1.5 py-1 text-accent">{l.status}</td>
                      <td className="px-1.5 py-1 text-muted-foreground truncate max-w-[320px]">{JSON.stringify(l.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {/* Live charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Tick Latency (ms)</div>
            <div className="text-[10px] font-mono text-muted-foreground">avg {dx.avgLatencyMs.toFixed(1)} · max {dx.maxLatencyMs.toFixed(1)}</div>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer>
              <LineChart data={latencyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="tick" hide />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                <ReferenceLine y={dx.avgLatencyMs} stroke="hsl(var(--primary))" strokeDasharray="2 2" />
                <ReferenceLine y={dx.maxLatencyMs} stroke="hsl(var(--destructive))" strokeDasharray="2 2" />
                {selectedTick != null && <ReferenceLine x={selectedTick} stroke="hsl(var(--accent))" strokeWidth={2} />}
                <Line type="monotone" dataKey="latency" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Activation Rate (per tick)</div>
            <div className="text-[10px] font-mono text-muted-foreground">now {dx.activationRate.toFixed(2)}</div>
          </div>
          <div style={{ width: '100%', height: 110 }}>
            <ResponsiveContainer>
              <LineChart data={actChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="tick" hide />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }} />
                <ReferenceLine y={dx.activationRate} stroke="hsl(var(--primary))" strokeDasharray="2 2" />
                {selectedTick != null && <ReferenceLine x={selectedTick} stroke="hsl(var(--accent))" strokeWidth={2} />}
                <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportSeriesCsv} className="h-7 text-xs">
          <Download className="h-3 w-3 mr-1" /> Export Series CSV
        </Button>
      </div>

      {/* Guardrail violation viewer */}
      <div className="rounded border border-border bg-background/40 p-2">
        <div className="flex items-center gap-1.5 mb-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-warning" />
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Guardrail Violations · last {Math.min(dx.guardrailViolations.length, 20)} of {dx.guardrailViolations.length}
          </div>
        </div>
        {dx.guardrailViolations.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No guardrail violations recorded.</div>
        ) : (
          <div ref={guardrailContainerRef} className="max-h-60 overflow-y-auto terminal-scrollbar space-y-1">
            {dx.guardrailViolations.slice(0, 20).map((v, i) => {
              const highlight = selectedTick != null && v.tick === selectedTick;
              return (
                <div
                  key={i}
                  data-tick={v.tick}
                  className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                    highlight ? 'border-accent bg-accent/10' : 'border-border bg-background/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-display tracking-wide">
                      {v.source.toUpperCase()} {v.regime ? `· ${v.regime}` : ''} · tick {v.tick}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">{new Date(v.ts).toLocaleTimeString()}</div>
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-0.5">
                    {v.details.map((d, j) => (
                      <div key={j} className={`font-mono ${d.clamped ? 'text-warning' : 'text-muted-foreground'}`}>
                        <span className="text-foreground">{d.field}</span>: {d.before.toFixed(4)} → {d.after.toFixed(4)}
                        {' '}<span className="text-muted-foreground">[bounds {d.bounds.min}…{Number.isFinite(d.bounds.max) ? d.bounds.max : '∞'}]</span>
                        {d.normalized && <span className="text-accent"> · normalized</span>}
                        {d.clamped && <span className="text-warning"> · CLAMPED</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Persisted events query — with search, regime filter, pagination */}
      <div className="rounded border border-border bg-background/40 p-2">
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Persisted Events · page {page + 1} / {totalPages} · {totalCount} total
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="relative">
              <Search className="h-3 w-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text" placeholder="search type, regime, title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-[11px] bg-background border border-border rounded pl-6 pr-2 font-mono w-44"
              />
            </div>
            <input
              type="text" placeholder="regime"
              value={regimeFilter}
              onChange={(e) => setRegimeFilter(e.target.value)}
              className="h-7 text-[11px] bg-background border border-border rounded px-1.5 font-mono w-24"
            />
            <select
              value={rangeHours}
              onChange={(e) => setRangeHours(Number(e.target.value))}
              className="h-7 text-[11px] bg-background border border-border rounded px-1.5 font-mono"
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>72h</option>
              <option value={168}>7d</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RansDiagEventType | 'all')}
              className="h-7 text-[11px] bg-background border border-border rounded px-1.5 font-mono"
            >
              <option value="all">all types</option>
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={loadEvents} disabled={loadingEvents} className="h-7 text-xs">
              <RefreshCw className={`h-3 w-3 mr-1 ${loadingEvents ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={exportEventsCsv} className="h-7 text-xs">
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        </div>
        {events.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No persisted events in this range.</div>
        ) : (
          <div className="max-h-60 overflow-y-auto terminal-scrollbar">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left px-1.5 py-1">Time</th>
                  <th className="text-left px-1.5 py-1">Type</th>
                  <th className="text-left px-1.5 py-1">Sev</th>
                  <th className="text-left px-1.5 py-1">Detail</th>
                  <th className="text-left px-1.5 py-1">Replay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {events.map((e, i) => {
                  const tick = resolveEventTick(e);
                  const isSel = tick != null && tick === selectedTick;
                  return (
                    <tr key={i} className={isSel ? 'bg-accent/10' : ''}>
                      <td className="px-1.5 py-1 font-mono text-muted-foreground whitespace-nowrap">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                      </td>
                      <td className="px-1.5 py-1 font-display tracking-wide">{e.event_type}</td>
                      <td className={`px-1.5 py-1 font-mono ${e.severity === 'critical' ? 'text-destructive' : e.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>
                        {e.severity}
                      </td>
                      <td className="px-1.5 py-1 font-mono text-[10px] truncate max-w-[360px]">
                        {JSON.stringify(e.detail)}
                      </td>
                      <td className="px-1.5 py-1 whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => replayEvent(e)} disabled={tick == null}>
                          <Play className="h-3 w-3 mr-1" /> {tick != null ? `t${tick}` : '—'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => copyDeepLink(e)} disabled={!e.id}>
                          <Link2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-1.5 mt-1.5">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="h-7 text-xs">
            <ChevronLeft className="h-3 w-3" /> Prev
          </Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">
            Next <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {dx.lastError && (
        <div className="text-[11px] font-mono text-destructive border border-destructive/30 bg-destructive/5 rounded px-2 py-1.5">
          Last error{dx.lastErrorTs ? ` (${new Date(dx.lastErrorTs).toLocaleTimeString()})` : ''}: {dx.lastError}
        </div>
      )}
    </div>
  );
};

export default RansDiagnosticsPanel;
