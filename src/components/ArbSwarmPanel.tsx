import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Brain, Zap, ShieldAlert, ScrollText, FlaskConical, RotateCcw, Download, Play, Trash2, GitCompareArrows, Save, X, Link2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import type { ArbitrageSignal } from '@/lib/multi-market-arbitrage';
import type { SwarmPrediction, LatencyArbEvent } from '@/lib/polyswarm-integrator';
import {
  getArbLimits, setArbLimits, resetArbLimits, subscribeArbLimits, type ArbRiskLimits,
} from '@/lib/arb-risk-config';
import {
  fetchArbAudit, subscribeArbAudit, getLocalArbAudit, purgeArbAudit,
  filterArbAudit, arbAuditExportRows, searchArbAudit, type ArbAuditEntry,
} from '@/lib/arb-audit';
import { loadAuditPrefs, saveAuditPrefs } from '@/lib/audit-export-prefs';
import {
  runArbBacktest, arbBacktestToCsv, DEFAULT_ARB_BACKTEST, ticksFromWindow,
  type ArbBacktestConfig, type ArbBacktestResult,
} from '@/lib/arb-backtest';
import {
  listArbPresets, applyArbPreset, saveCurrentAsPreset, deleteArbPreset,
  getActivePresetName, subscribeArbPresets,
} from '@/lib/arb-risk-presets';
import {
  listBacktestPresets, saveBacktestPreset, deleteBacktestPreset, getBacktestPreset,
  getActiveBacktestPreset, setActiveBacktestPreset, subscribeBacktestPresets,
  scenarioShareLink, readSharedScenario, SHARE_PARAM,
} from '@/lib/arb-backtest-presets';
import { validateBacktestRun } from '@/lib/backtest-validation';
import { getDrawdownGuard, subscribeDrawdownGuard, type DrawdownGuardConfig } from '@/lib/drawdown-guard';
import { streamingDownloadCSV, streamingDownloadJSON } from '@/lib/streaming-export';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import LivePaperComparePanel from './LivePaperComparePanel';


interface Props {
  signals: ArbitrageSignal[];
  executed: ArbitrageSignal[];
  realized: number;
  swarmSignals: SwarmPrediction[];
  swarmEvents: LatencyArbEvent[];
  agentCount: number;
}

const TYPE_COLOR: Record<string, string> = {
  mutually_exclusive: 'text-primary',
  dependent: 'text-info',
  combinatorial: 'text-warning',
};

function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NumberField: React.FC<{
  label: string; value: number; step?: number; min?: number; suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, step = 1, min = 0, suffix, onChange }) => (
  <div className="space-y-1">
    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}{suffix ? ` (${suffix})` : ''}</Label>
    <Input
      type="number" step={step} min={min} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="h-8 font-mono text-xs"
      aria-label={label}
    />
  </div>
);

const ArbSwarmPanel: React.FC<Props> = ({ signals, executed, realized, swarmSignals, swarmEvents, agentCount }) => {
  const [limits, setLimits] = useState<ArbRiskLimits>(() => getArbLimits());
  const [audit, setAudit] = useState<ArbAuditEntry[]>(() => getLocalArbAudit());
  const [prefs0] = useState(() => loadAuditPrefs());
  const [auditRange, setAuditRange] = useState(prefs0.rangeMs);
  const [auditFilter, setAuditFilter] = useState<'all' | 'executed' | 'blocked'>(prefs0.action);
  const [auditStrategy, setAuditStrategy] = useState<'all' | 'multi_market_arb' | 'polyswarm'>(prefs0.strategy);
  const [auditMode, setAuditMode] = useState<'all' | 'paper' | 'live'>(prefs0.mode);
  const [auditReason, setAuditReason] = useState(prefs0.reason);
  const [auditSearch, setAuditSearch] = useState(prefs0.search);
  const [auditFormat, setAuditFormat] = useState<'csv' | 'json'>(prefs0.format);
  const [auditPageSize, setAuditPageSize] = useState(prefs0.pageSize);
  const [auditPage, setAuditPage] = useState(1);
  const [sharedPreview, setSharedPreview] = useState<{ name: string; config: ArbBacktestConfig } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [btConfig, setBtConfig] = useState<ArbBacktestConfig>(DEFAULT_ARB_BACKTEST);
  const [btRunning, setBtRunning] = useState(false);
  const [btProgress, setBtProgress] = useState(0);
  const [btResult, setBtResult] = useState<ArbBacktestResult | null>(null);
  const [presets, setPresets] = useState(() => listArbPresets());
  const [activePreset, setActivePreset] = useState(() => getActivePresetName());
  const [newPresetName, setNewPresetName] = useState('');
  const [btPresets, setBtPresets] = useState(() => listBacktestPresets());
  const [activeBtPreset, setActiveBtPreset] = useState<string | null>(() => getActiveBacktestPreset());
  const [newScenarioName, setNewScenarioName] = useState('');
  const [guard, setGuard] = useState<DrawdownGuardConfig>(() => getDrawdownGuard());
  const [ignoreWarnings, setIgnoreWarnings] = useState(false);

  useEffect(() => {
    saveAuditPrefs({
      rangeMs: auditRange, action: auditFilter, strategy: auditStrategy, mode: auditMode,
      reason: auditReason, search: auditSearch, format: auditFormat, pageSize: auditPageSize,
    });
  }, [auditRange, auditFilter, auditStrategy, auditMode, auditReason, auditSearch, auditFormat, auditPageSize]);

  useEffect(() => { setAuditPage(1); }, [auditRange, auditFilter, auditStrategy, auditMode, auditReason, auditSearch, auditPageSize]);

  useEffect(() => subscribeArbLimits(setLimits), []);
  useEffect(() => subscribeDrawdownGuard(setGuard), []);
  useEffect(() => subscribeArbPresets(() => { setPresets(listArbPresets()); setActivePreset(getActivePresetName()); }), []);
  useEffect(() => subscribeBacktestPresets(() => { setBtPresets(listBacktestPresets()); setActiveBtPreset(getActiveBacktestPreset()); }), []);

  useEffect(() => subscribeArbAudit(rows => setAudit(prev => (prev.length && prev[0]?.id ? rows : rows))), []);

  // Shared scenario deep link: ?scenario=<token>
  useEffect(() => {
    const shared = readSharedScenario();
    if (!shared) return;
    setSharedPreview(shared);
  }, []);

  const loadAudit = useCallback(async () => {
    const rows = await fetchArbAudit(auditRange, 300);
    setAudit(rows);
  }, [auditRange]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  const update = (patch: Partial<ArbRiskLimits>) => setLimits(setArbLimits(patch));

  const filteredAudit = useMemo(
    () => searchArbAudit(filterArbAudit(audit, {
      sinceMs: auditRange, action: auditFilter, strategy: auditStrategy,
      mode: auditMode, reason: auditFilter === 'executed' ? '' : auditReason,
    }), auditSearch),
    [audit, auditRange, auditFilter, auditStrategy, auditMode, auditReason, auditSearch],
  );

  const auditPages = Math.max(1, Math.ceil(filteredAudit.length / auditPageSize));
  const auditPageSafe = Math.min(auditPage, auditPages);
  const pagedAudit = useMemo(
    () => filteredAudit.slice((auditPageSafe - 1) * auditPageSize, auditPageSafe * auditPageSize),
    [filteredAudit, auditPageSafe, auditPageSize],
  );

  const paperStats = useMemo(() => {
    const ex = audit.filter(a => a.action === 'executed');
    const profit = ex.reduce((s, a) => s + a.profit, 0);
    return { executions: ex.length, blocked: audit.filter(a => a.action === 'blocked').length, profit };
  }, [audit]);

  const exportAudit = async (fmt: 'csv' | 'json') => {
    const rows = arbAuditExportRows(filteredAudit);
    setExporting(true);
    try {
      const stamp = Date.now();
      if (fmt === 'csv') await streamingDownloadCSV(`arb-audit-${stamp}.csv`, rows);
      else await streamingDownloadJSON(`arb-audit-${stamp}.json`, rows, {
        rangeMs: auditRange, action: auditFilter, strategy: auditStrategy, mode: auditMode, reason: auditReason,
      });
      toast.success(`Exported ${rows.length} audited actions (${fmt.toUpperCase()})`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const validation = useMemo(
    () => validateBacktestRun(btConfig, limits, guard, activeBtPreset, activeBtPreset ? getBacktestPreset(activeBtPreset) : null),
    [btConfig, limits, guard, activeBtPreset],
  );

  const sharedValidation = useMemo(
    () => (sharedPreview ? validateBacktestRun(sharedPreview.config, limits, guard, null, null) : null),
    [sharedPreview, limits, guard],
  );

  const clearShareParam = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(SHARE_PARAM);
      window.history.replaceState({}, '', url.toString());
    } catch { /* ignore */ }
  }, []);

  const runBacktest = async (cfg: ArbBacktestConfig = btConfig) => {
    const report = validateBacktestRun(cfg, limits, guard, activeBtPreset, activeBtPreset ? getBacktestPreset(activeBtPreset) : null);
    if (!report.ok) {
      toast.error(`Run blocked — ${report.errors.length} configuration error${report.errors.length > 1 ? 's' : ''}`);
      return;
    }
    if (report.warnings.length && !ignoreWarnings) {
      toast.warning(`${report.warnings.length} warning(s) — tick "Run anyway" to proceed`);
      return;
    }
    setBtRunning(true); setBtProgress(0);
    try {
      const res = await runArbBacktest(cfg, setBtProgress);

      setBtResult(res);
      toast.success(`Backtest complete · net $${res.combinedNet.toFixed(2)}`);
    } catch {
      toast.error('Backtest failed');
    } finally {
      setBtRunning(false);
    }
  };


  return (
    <Tabs defaultValue="live" className="space-y-4">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="live" className="text-xs"><Layers className="h-3 w-3 mr-1" />Live</TabsTrigger>
        <TabsTrigger value="risk" className="text-xs"><ShieldAlert className="h-3 w-3 mr-1" />Risk</TabsTrigger>
        <TabsTrigger value="audit" className="text-xs"><ScrollText className="h-3 w-3 mr-1" />Audit</TabsTrigger>
        <TabsTrigger value="compare" className="text-xs"><GitCompareArrows className="h-3 w-3 mr-1" />Compare</TabsTrigger>
        <TabsTrigger value="backtest" className="text-xs"><FlaskConical className="h-3 w-3 mr-1" />Backtest</TabsTrigger>
      </TabsList>

      {/* ---------------- LIVE ---------------- */}
      <TabsContent value="live" className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Live Arb Ops</p>
            <p className="font-mono text-lg text-primary">{signals.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Realized Arb</p>
            <p className="font-mono text-lg text-primary">${realized.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Swarm Agents</p>
            <p className="font-mono text-lg text-info">{agentCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <Badge variant={limits.paperMode ? 'secondary' : 'destructive'} className="font-mono">
            {limits.paperMode ? 'PAPER TRADING' : 'LIVE MODE'}
          </Badge>
          <Badge variant={limits.executionEnabled ? 'outline' : 'destructive'} className="font-mono">
            {limits.executionEnabled ? 'EXECUTION ON' : 'EXECUTION HALTED'}
          </Badge>
        </div>

        <section className="rounded-lg border border-border bg-card p-3">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
            <Layers className="h-4 w-4 text-primary" /> Multi-Market Arbitrage Signals
          </h3>
          {signals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No guaranteed-profit structures detected this tick.</p>
          ) : (
            <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {signals.slice(0, 25).map(s => (
                <li key={s.id} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
                  <span className={`uppercase w-32 shrink-0 ${TYPE_COLOR[s.type] ?? ''}`}>{s.type.replace(/_/g, ' ')}</span>
                  <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
                  <span className="text-muted-foreground">{s.legs.length} legs</span>
                  <span className="text-primary">+${s.guaranteedProfit.toFixed(3)}</span>
                  <span className="text-muted-foreground">{(s.confidence * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-3">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
            <Zap className="h-4 w-4 text-warning" /> Executed Arbitrage
          </h3>
          {executed.length === 0 ? (
            <p className="text-xs text-muted-foreground">No arbitrage executed yet.</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {executed.slice(0, 20).map(s => (
                <li key={`${s.id}-${s.ts}`} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
                  <span className="text-muted-foreground w-16 shrink-0">{new Date(s.ts).toLocaleTimeString()}</span>
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="text-primary">+${s.guaranteedProfit.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-3">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold mb-2">
            <Brain className="h-4 w-4 text-info" /> PolySwarm Inefficiencies (KL/JS divergence)
          </h3>
          {swarmSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">Swarm consensus matches market pricing.</p>
          ) : (
            <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {swarmSignals.map(p => (
                <li key={p.marketId} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
                  <span className="flex-1 truncate">{p.slug ?? p.marketId}</span>
                  <span className="text-muted-foreground">p {p.swarmProbability.toFixed(3)}</span>
                  <span className={p.divergence >= limits.divergenceAlertThreshold ? 'text-destructive' : 'text-info'}>
                    div {p.divergence.toFixed(4)}
                  </span>
                  <span className="text-muted-foreground">{(p.swarmConfidence * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
          {swarmEvents.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
              {swarmEvents.slice(0, 10).map(e => (
                <li key={`${e.marketId}-${e.ts}`} className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <span className="w-16 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className={e.direction === 'BUY' ? 'text-primary' : 'text-warning'}>{e.direction}</span>
                  <span className="flex-1 truncate">{e.slug ?? e.marketId}</span>
                  <span>edge {e.edge.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </TabsContent>

      {/* ---------------- RISK LIMITS ---------------- */}
      <TabsContent value="risk" className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <h3 className="font-display text-sm font-semibold">Risk Presets</h3>
          <div className="flex flex-wrap items-center gap-2">
            {presets.map(p => (
              <div key={p.name} className="flex items-center">
                <Button
                  size="sm"
                  variant={activePreset === p.name ? 'default' : 'outline'}
                  className="h-7 text-xs capitalize"
                  title={p.description}
                  aria-label={`Apply ${p.name} risk preset`}
                  onClick={() => {
                    const next = applyArbPreset(p.name);
                    if (next) { setLimits(next); setActivePreset(p.name); toast.success(`Preset "${p.name}" applied`); }
                  }}
                >{p.name}</Button>
                {!p.builtin && (
                  <Button
                    size="icon" variant="ghost" className="h-7 w-6"
                    aria-label={`Delete preset ${p.name}`}
                    onClick={() => { deleteArbPreset(p.name); setPresets(listArbPresets()); toast.message(`Preset "${p.name}" deleted`); }}
                  ><X className="h-3 w-3" /></Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="Save current limits as…"
              className="h-8 text-xs"
              aria-label="New preset name"
            />
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              disabled={!newPresetName.trim()}
              onClick={() => {
                const p = saveCurrentAsPreset(newPresetName);
                setPresets(listArbPresets()); setActivePreset(p.name); setNewPresetName('');
                toast.success(`Preset "${p.name}" saved`);
              }}
            ><Save className="h-3 w-3 mr-1" />Save</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Presets persist locally. Applying one never flips paper/live — that switch stays under your control.
          </p>
        </section>
        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-warning" /> Execution Risk Limits
            </h3>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setLimits(resetArbLimits()); toast.message('Limits reset to defaults'); }}>
              <RotateCcw className="h-3 w-3 mr-1" />Reset
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
            <div>
              <p className="text-xs font-medium">Execution enabled</p>
              <p className="text-[10px] text-muted-foreground">Off = scan only, no fills</p>
            </div>
            <Switch checked={limits.executionEnabled} onCheckedChange={v => update({ executionEnabled: v })} aria-label="Toggle arbitrage execution" />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
            <div>
              <p className="text-xs font-medium">Paper trading mode</p>
              <p className="text-[10px] text-muted-foreground">Simulated fills; every action written to the audit log</p>
            </div>
            <Switch checked={limits.paperMode} onCheckedChange={v => update({ paperMode: v })} aria-label="Toggle paper trading mode" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Max capital / arb" suffix="$" value={limits.maxCapitalPerArb} step={50} onChange={v => update({ maxCapitalPerArb: v })} />
            <NumberField label="Max capital / tick" suffix="$" value={limits.maxCapitalPerTick} step={100} onChange={v => update({ maxCapitalPerTick: v })} />
            <NumberField label="Min profit" suffix="$" value={limits.minProfit} step={0.01} onChange={v => update({ minProfit: v })} />
            <NumberField label="Min confidence" suffix="0-1" value={limits.minConfidence} step={0.05} onChange={v => update({ minConfidence: v })} />
            <NumberField label="Max legs" value={limits.maxLegs} onChange={v => update({ maxLegs: v })} />
            <NumberField label="Max executions / tick" value={limits.maxExecutionsPerTick} onChange={v => update({ maxExecutionsPerTick: v })} />
            <NumberField label="Max daily arb loss" suffix="$" value={limits.maxDailyArbLoss} step={25} onChange={v => update({ maxDailyArbLoss: v })} />
            <NumberField label="Min swarm edge" value={limits.minSwarmEdge} step={0.005} onChange={v => update({ minSwarmEdge: v })} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <h3 className="font-display text-sm font-semibold">Strategy Health Alert Thresholds</h3>
          <p className="text-[11px] text-muted-foreground">
            Alerts fire in the notification bell when the top swarm divergence or the HTM anomaly score crosses these values (rate-limited to one per minute).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Divergence alert" value={limits.divergenceAlertThreshold} step={0.01} onChange={v => update({ divergenceAlertThreshold: v })} />
            <NumberField label="Anomaly alert" value={limits.anomalyAlertThreshold} step={0.05} onChange={v => update({ anomalyAlertThreshold: v })} />
          </div>
        </section>
      </TabsContent>

      {/* ---------------- AUDIT ---------------- */}
      <TabsContent value="audit" className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Simulated fills</p>
            <p className="font-mono text-lg text-primary">{paperStats.executions}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Blocked by limits</p>
            <p className="font-mono text-lg text-warning">{paperStats.blocked}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Audited P&amp;L</p>
            <p className="font-mono text-lg text-primary">${paperStats.profit.toFixed(2)}</p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Time</span>
            {([['1h', 3600e3], ['24h', 86400e3], ['7d', 604800e3], ['All', 0]] as [string, number][]).map(([lbl, ms]) => (
              <Button key={lbl} size="sm" variant={auditRange === ms ? 'default' : 'outline'} className="h-7 text-xs"
                aria-label={`Audit window ${lbl}`} onClick={() => setAuditRange(ms)}>{lbl}</Button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Action</span>
            {(['all', 'executed', 'blocked'] as const).map(f => (
              <Button key={f} size="sm" variant={auditFilter === f ? 'default' : 'outline'} className="h-7 text-xs capitalize"
                aria-label={`Filter action ${f}`} onClick={() => setAuditFilter(f)}>{f}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Strategy</span>
            {(['all', 'multi_market_arb', 'polyswarm'] as const).map(s => (
              <Button key={s} size="sm" variant={auditStrategy === s ? 'default' : 'outline'} className="h-7 text-xs"
                aria-label={`Filter strategy ${s}`} onClick={() => setAuditStrategy(s)}>{s}</Button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Mode</span>
            {(['all', 'paper', 'live'] as const).map(m => (
              <Button key={m} size="sm" variant={auditMode === m ? 'default' : 'outline'} className="h-7 text-xs"
                aria-label={`Filter mode ${m}`} onClick={() => setAuditMode(m)}>{m}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              placeholder="Search execution id, label, price, slippage, reason…"
              className="h-8 flex-1 min-w-[14rem] text-xs"
              aria-label="Search audit log"
            />
            <Button size="sm" variant="ghost" className="h-8 text-xs" aria-label="Clear audit search"
              disabled={!auditSearch} onClick={() => setAuditSearch('')}>
              <X className="h-3 w-3 mr-1" />Clear search
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={auditReason}
              onChange={e => setAuditReason(e.target.value)}
              placeholder="Filter by blocked reason (e.g. confidence, capital)…"
              className="h-8 flex-1 min-w-[12rem] text-xs"
              aria-label="Filter by blocked reason"
              disabled={auditFilter === 'executed'}
            />
            <Button size="sm" variant={auditFormat === 'csv' ? 'default' : 'outline'} className="h-8 text-xs" disabled={exporting}
              aria-label="Export filtered audit log as CSV" onClick={() => { setAuditFormat('csv'); exportAudit('csv'); }}>
              <Download className="h-3 w-3 mr-1" />CSV
            </Button>
            <Button size="sm" variant={auditFormat === 'json' ? 'default' : 'outline'} className="h-8 text-xs" disabled={exporting}
              aria-label="Export filtered audit log as JSON" onClick={() => { setAuditFormat('json'); exportAudit('json'); }}>
              <Download className="h-3 w-3 mr-1" />JSON
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" aria-label="Clear audit log"
              onClick={async () => { await purgeArbAudit(); await loadAudit(); toast.message('Audit log cleared'); }}>
              <Trash2 className="h-3 w-3 mr-1" />Clear
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Exporting {filteredAudit.length} of {audit.length} audited actions with the filters above (default format: {auditFormat.toUpperCase()}).
            Filters and format are remembered for next time. JSON keeps the full rule-evaluation detail.
          </p>
        </div>


        <section className="rounded-lg border border-border bg-card p-3">
          {filteredAudit.length === 0 ? (
            <p className="text-xs text-muted-foreground">No audited actions in this window yet.</p>
          ) : (
            <ul className="space-y-1 max-h-96 overflow-y-auto pr-1">
              {pagedAudit.map((a, i) => (
                <li key={a.id ?? `${a.created_at}-${i}`} className="flex items-center gap-2 text-[11px] font-mono border-b border-border/30 py-1">
                  <span className="w-16 shrink-0 text-muted-foreground">{new Date(a.created_at).toLocaleTimeString()}</span>
                  <span className={`w-20 shrink-0 uppercase ${a.action === 'executed' ? 'text-primary' : 'text-warning'}`}>{a.action}</span>
                  <span className="w-24 shrink-0 text-muted-foreground">{a.source === 'polyswarm' ? 'swarm' : 'multi-arb'}</span>
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.reason ? <span className="text-muted-foreground truncate max-w-[9rem]">{a.reason}</span>
                    : <span className="text-primary">+${a.profit.toFixed(3)}</span>}
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">{a.mode}</Badge>
                </li>
              ))}
            </ul>
          )}
          {filteredAudit.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2 text-[11px]">
              <span className="text-muted-foreground font-mono">
                {(auditPageSafe - 1) * auditPageSize + 1}–{Math.min(auditPageSafe * auditPageSize, filteredAudit.length)} of {filteredAudit.length}
              </span>
              <span className="flex-1" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Rows</span>
              {[25, 50, 100].map(n => (
                <Button key={n} size="sm" variant={auditPageSize === n ? 'default' : 'outline'} className="h-7 text-xs"
                  aria-label={`Show ${n} rows per page`} onClick={() => setAuditPageSize(n)}>{n}</Button>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={auditPageSafe <= 1}
                aria-label="Previous audit page" onClick={() => setAuditPage(p => Math.max(1, p - 1))}>Prev</Button>
              <span className="font-mono text-muted-foreground">page {auditPageSafe}/{auditPages}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={auditPageSafe >= auditPages}
                aria-label="Next audit page" onClick={() => setAuditPage(p => Math.min(auditPages, p + 1))}>Next</Button>
            </div>
          )}
        </section>
      </TabsContent>

      {/* ---------------- LIVE VS PAPER ---------------- */}
      <TabsContent value="compare" className="space-y-3">
        <LivePaperComparePanel />
      </TabsContent>

      {/* ---------------- BACKTEST ---------------- */}
      <TabsContent value="backtest" className="space-y-3">
        <section className="rounded-lg border border-border bg-card p-3 space-y-2">
          <h3 className="font-display text-sm font-semibold">Saved scenarios</h3>
          <div className="flex flex-wrap items-center gap-2">
            {btPresets.length === 0 && <span className="text-[11px] text-muted-foreground">No saved scenarios yet.</span>}
            {btPresets.map(p => (
              <div key={p.name} className="flex items-center">
                <Button
                  size="sm" variant={activeBtPreset === p.name ? 'default' : 'outline'} className="h-7 text-xs"
                  aria-label={`Load and run scenario ${p.name}`}
                  onClick={() => {
                    const cfg = getBacktestPreset(p.name);
                    if (!cfg) return;
                    setBtConfig(cfg);
                    setActiveBacktestPreset(p.name);
                    setActiveBtPreset(p.name);
                    toast.success(`Scenario "${p.name}" loaded — running`);
                    void runBacktest(cfg);
                  }}
                >{p.name}</Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-6"
                  aria-label={`Copy share link for scenario ${p.name}`}
                  onClick={async () => {
                    const cfg = getBacktestPreset(p.name);
                    if (!cfg) return;
                    const ok = await copyToClipboard(scenarioShareLink(p.name, cfg));
                    ok ? toast.success(`Share link for "${p.name}" copied`) : toast.error('Copy failed');
                  }}
                ><Link2 className="h-3 w-3" /></Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-6"
                  aria-label={`Delete scenario ${p.name}`}
                  onClick={() => { deleteBacktestPreset(p.name); setBtPresets(listBacktestPresets()); setActiveBtPreset(getActiveBacktestPreset()); }}
                ><X className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={newScenarioName}
              onChange={e => setNewScenarioName(e.target.value)}
              placeholder="Save current backtest config as…"
              className="h-8 text-xs"
              aria-label="New scenario name"
            />
            <Button
              size="sm" variant="outline" className="h-8 text-xs" disabled={!newScenarioName.trim()}
              onClick={() => {
                const p = saveBacktestPreset(newScenarioName, btConfig);
                setBtPresets(listBacktestPresets()); setActiveBtPreset(p.name); setNewScenarioName('');
                toast.success(`Scenario "${p.name}" saved`);
              }}
            ><Save className="h-3 w-3 mr-1" />Save</Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs"
              aria-label="Copy share link for the current backtest configuration"
              onClick={async () => {
                const name = newScenarioName.trim() || activeBtPreset || 'shared scenario';
                const ok = await copyToClipboard(scenarioShareLink(name, btConfig));
                ok ? toast.success('Shareable scenario link copied') : toast.error('Copy failed');
              }}
            ><Link2 className="h-3 w-3 mr-1" />Share link</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Scenarios store the window, tick interval, fee/slippage and risk caps so a run is reproducible. A share link encodes the whole
            configuration in the URL — opening it loads the scenario in one click.
          </p>
        </section>

        {/* Pre-run validation */}
        <section
          className={`rounded-lg border p-3 space-y-2 ${
            validation.errors.length ? 'border-destructive/60 bg-destructive/5'
              : validation.warnings.length ? 'border-warning/50 bg-warning/5' : 'border-border bg-card'
          }`}
          aria-live="polite"
        >
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
            {validation.ok
              ? <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              : <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />}
            Pre-run validation
          </h3>
          {validation.issues.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Risk limits, cooldown/smoothing settings and the active scenario are consistent — safe to run.
            </p>
          ) : (
            <ul className="space-y-1">
              {validation.issues.map((iss, i) => (
                <li key={`${iss.field}-${i}`} className="flex items-start gap-2 text-[11px] font-mono">
                  <Badge variant={iss.level === 'error' ? 'destructive' : 'outline'} className="mt-0.5 shrink-0 text-[9px]">
                    {iss.level}
                  </Badge>
                  <span className="text-muted-foreground"><span className="text-foreground">{iss.field}</span> — {iss.message}</span>
                </li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && validation.errors.length === 0 && (
            <label className="flex items-center gap-2 text-[11px]">
              <Switch checked={ignoreWarnings} onCheckedChange={setIgnoreWarnings} aria-label="Run anyway despite warnings" />
              Run anyway (acknowledge {validation.warnings.length} warning{validation.warnings.length > 1 ? 's' : ''})
            </label>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-3 space-y-3">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-info" /> Strategy Backtest Runner
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Start</Label>
              <Input
                type="datetime-local" className="h-8 font-mono text-xs" aria-label="Backtest start time"
                value={toLocalInput(btConfig.startTime)}
                onChange={e => setBtConfig(c => ({ ...c, startTime: new Date(e.target.value).getTime() || c.startTime }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">End</Label>
              <Input
                type="datetime-local" className="h-8 font-mono text-xs" aria-label="Backtest end time"
                value={toLocalInput(btConfig.endTime)}
                onChange={e => setBtConfig(c => ({ ...c, endTime: new Date(e.target.value).getTime() || c.endTime }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Tick interval" suffix="s" value={Math.round(btConfig.tickIntervalMs / 1000)} step={30}
              onChange={v => setBtConfig(c => ({ ...c, tickIntervalMs: Math.max(1, v) * 1000 }))} />
            <NumberField label="Markets / tick" value={btConfig.marketsPerTick} onChange={v => setBtConfig(c => ({ ...c, marketsPerTick: Math.max(2, v) }))} />
            <NumberField label="Seed" value={btConfig.seed} onChange={v => setBtConfig(c => ({ ...c, seed: v }))} />
            <NumberField label="Fee" suffix="bps" value={btConfig.feeBps} step={5} onChange={v => setBtConfig(c => ({ ...c, feeBps: Math.max(0, v) }))} />
            <NumberField label="Slippage" suffix="bps" value={btConfig.slippageBps} step={5} onChange={v => setBtConfig(c => ({ ...c, slippageBps: Math.max(0, v) }))} />
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Resolved ticks</Label>
              <div className="h-8 flex items-center font-mono text-xs text-primary">{ticksFromWindow(btConfig)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
            <NumberField label="Cap / arb override" suffix="$" step={50}
              value={btConfig.riskOverrides.maxCapitalPerArb ?? limits.maxCapitalPerArb}
              onChange={v => setBtConfig(c => ({ ...c, riskOverrides: { ...c.riskOverrides, maxCapitalPerArb: v } }))} />
            <NumberField label="Cap / tick override" suffix="$" step={100}
              value={btConfig.riskOverrides.maxCapitalPerTick ?? limits.maxCapitalPerTick}
              onChange={v => setBtConfig(c => ({ ...c, riskOverrides: { ...c.riskOverrides, maxCapitalPerTick: v } }))} />
            <NumberField label="Max exec / tick override"
              value={btConfig.riskOverrides.maxExecutionsPerTick ?? limits.maxExecutionsPerTick}
              onChange={v => setBtConfig(c => ({ ...c, riskOverrides: { ...c.riskOverrides, maxExecutionsPerTick: v } }))} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]"
              onClick={() => setBtConfig(c => ({ ...c, riskOverrides: {} }))}
              aria-label="Clear risk caps overrides">
              <RotateCcw className="h-3 w-3 mr-1" />Use saved risk limits
            </Button>
            <span className="text-[10px] text-muted-foreground">
              {Object.keys(btConfig.riskOverrides).length ? 'Run-scoped caps active' : 'Running with the saved limits above'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={btConfig.strategies.multiMarketArb} aria-label="Include multi market arbitrage"
                onCheckedChange={v => setBtConfig(c => ({ ...c, strategies: { ...c.strategies, multiMarketArb: v } }))} />
              multi_market_arb
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={btConfig.strategies.polyswarm} aria-label="Include polyswarm"
                onCheckedChange={v => setBtConfig(c => ({ ...c, strategies: { ...c.strategies, polyswarm: v } }))} />
              polyswarm
            </label>
            <span className="flex-1" />
            <Button
              size="sm" className="h-8 text-xs"
              disabled={btRunning || !validation.ok || (validation.warnings.length > 0 && !ignoreWarnings)}
              title={!validation.ok ? 'Fix the configuration errors above first' : undefined}
              onClick={() => runBacktest()}
            >
              <Play className="h-3 w-3 mr-1" />{btRunning ? 'Running…' : 'Run backtest'}
            </Button>

            {btResult && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => download(`arb-backtest-${btResult.ranAt}.csv`, arbBacktestToCsv(btResult))}>
                <Download className="h-3 w-3 mr-1" />CSV
              </Button>
            )}
          </div>
          {btRunning && <Progress value={btProgress} className="h-1.5" />}
          <p className="text-[10px] text-muted-foreground">
            The runner applies the same risk limits configured above, so blocked-trade counts show exactly how your limits shape results.
          </p>
        </section>

        {btResult && (
          <>
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-display text-sm font-semibold">Results</h4>
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(btResult.ranAt).toLocaleTimeString()} · net{' '}
                  <span className={btResult.combinedNet >= 0 ? 'text-primary' : 'text-destructive'}>${btResult.combinedNet.toFixed(2)}</span>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/50">
                      <th className="text-left py-1">strategy</th><th className="text-right">signals</th><th className="text-right">exec</th>
                      <th className="text-right">blocked</th><th className="text-right">net</th><th className="text-right">hit</th>
                      <th className="text-right">sharpe</th><th className="text-right">maxDD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {btResult.results.map(r => (
                      <tr key={r.strategy} className="border-b border-border/30">
                        <td className="py-1">{r.strategy}</td>
                        <td className="text-right">{r.signals}</td>
                        <td className="text-right">{r.executions}</td>
                        <td className="text-right text-warning">{r.blocked}</td>
                        <td className={`text-right ${r.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>${r.netProfit.toFixed(2)}</td>
                        <td className="text-right">{(r.hitRate * 100).toFixed(1)}%</td>
                        <td className="text-right">{r.sharpe.toFixed(2)}</td>
                        <td className="text-right">${r.maxDrawdown.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {Object.keys(btResult.blockedReasons).length > 0 && (
              <section className="rounded-lg border border-border bg-card p-3">
                <h4 className="font-display text-sm font-semibold mb-2">Blocked by limit</h4>
                <ul className="space-y-1">
                  {Object.entries(btResult.blockedReasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <li key={reason} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="flex-1 truncate text-muted-foreground">{reason}</span>
                      <span className="text-warning">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </TabsContent>

      {/* ---------------- SHARED SCENARIO PREVIEW ---------------- */}
      <Dialog open={!!sharedPreview} onOpenChange={o => { if (!o) { setSharedPreview(null); clearShareParam(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4 text-info" aria-hidden />Shared scenario preview
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {sharedPreview?.name} — review the parsed configuration before it replaces your current backtest setup.
            </DialogDescription>
          </DialogHeader>
          {sharedPreview && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
                {([
                  ['window', `${new Date(sharedPreview.config.startTime).toLocaleString()} → ${new Date(sharedPreview.config.endTime).toLocaleString()}`],
                  ['tick interval', `${Math.round(sharedPreview.config.tickIntervalMs / 1000)}s`],
                  ['resolved ticks', String(ticksFromWindow(sharedPreview.config))],
                  ['markets / tick', String(sharedPreview.config.marketsPerTick)],
                  ['fee / slippage', `${sharedPreview.config.feeBps} / ${sharedPreview.config.slippageBps} bps`],
                  ['seed', String(sharedPreview.config.seed)],
                  ['strategies', Object.entries(sharedPreview.config.strategies).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'],
                  ['risk overrides', Object.keys(sharedPreview.config.riskOverrides ?? {}).length
                    ? Object.entries(sharedPreview.config.riskOverrides).map(([k, v]) => `${k}=${v}`).join(', ')
                    : 'uses saved limits'],
                ] as [string, string][]).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</dt>
                    <dd className="truncate" title={v}>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <div className="rounded-md border border-border/60 p-2 space-y-1">
                <p className="flex items-center gap-2 text-[11px] font-semibold">
                  {sharedValidation && sharedValidation.ok
                    ? <><ShieldCheck className="h-3 w-3 text-primary" aria-hidden />Compatible with your current limits</>
                    : <><AlertTriangle className="h-3 w-3 text-destructive" aria-hidden />Compatibility issues</>}
                </p>
                {sharedValidation?.issues.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No conflicts with your saved risk limits or drawdown guard.</p>
                ) : sharedValidation?.issues.map((iss, i) => (
                  <p key={`${iss.field}-${i}`} className="flex items-start gap-2 text-[11px] font-mono">
                    <Badge variant={iss.level === 'error' ? 'destructive' : 'outline'} className="mt-0.5 shrink-0 text-[9px]">{iss.level}</Badge>
                    <span className="text-muted-foreground"><span className="text-foreground">{iss.field}</span> — {iss.message}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs"
              aria-label="Discard shared scenario"
              onClick={() => { setSharedPreview(null); clearShareParam(); toast.message('Shared scenario discarded'); }}>Discard</Button>
            <Button size="sm" className="h-8 text-xs"
              aria-label="Apply shared scenario"
              onClick={() => {
                if (!sharedPreview) return;
                setBtConfig(sharedPreview.config);
                setActiveBtPreset(sharedPreview.name);
                setIgnoreWarnings(false);
                toast.success(`Shared scenario "${sharedPreview.name}" applied`);
                setSharedPreview(null);
                clearShareParam();
              }}>Apply scenario</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
};

export default ArbSwarmPanel;
