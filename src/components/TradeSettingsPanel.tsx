import React, { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CONFIG,
  SETTINGS_SCHEMA,
  applySetting,
  resetSettings,
  type SettingsKey,
  type TradeSettings,
} from '@/lib/neural-bot-engine';

interface TradeSettingsPanelProps {
  initial: TradeSettings;
  onApply: (s: Partial<TradeSettings>) => void;
  open?: boolean;
  onClose?: () => void;
  logger?: (msg: string, type?: string) => void;
}

const SECTION_ORDER = [
  { title: 'Position Sizing', accent: '#22d3ee', keys: ['KELLY_FRACTION', 'MAX_POSITION_PCT', 'MAX_TOTAL_EXPOSURE_PCT', 'MIN_TRADE_SIZE_USDC', 'MAX_TRADE_SIZE_USDC'] as SettingsKey[] },
  { title: 'Loss Limits', accent: '#ef4444', keys: ['MAX_DAILY_LOSS_PCT', 'MAX_MONTHLY_LOSS_PCT', 'MAX_DRAWDOWN_PCT', 'TOTAL_LOSS_HALT_PCT', 'MAX_CONSECUTIVE_LOSSES'] as SettingsKey[] },
  { title: 'Profit Exits', accent: '#22c55e', keys: ['STOP_LOSS_PCT', 'TAKE_PROFIT_PCT', 'TRAILING_STOP_PCT', 'TIME_BASED_EXIT_HOURS', 'MIN_PROFIT_THRESHOLD_PCT'] as SettingsKey[] },
  { title: 'Market Filters', accent: '#eab308', keys: ['MIN_VOLUME_USDC', 'MIN_LIQUIDITY_USDC', 'MIN_PROBABILITY', 'MAX_PROBABILITY', 'MAX_SPREAD_PCT', 'MIN_TIME_TO_EXPIRY_HOURS', 'MAX_TIME_TO_EXPIRY_DAYS'] as SettingsKey[] },
  { title: 'Execution', accent: '#a78bfa', keys: ['SLIPPAGE_TOLERANCE_PCT', 'GAS_PRIORITY_GWEI', 'GAS_MAX_GWEI', 'ORDER_COOLDOWN_SECONDS', 'MAX_ORDERS_PER_MINUTE'] as SettingsKey[] },
] as const;

const KEY_TO_SECTION: Record<SettingsKey, 'RISK' | 'EXITS' | 'MARKET_FILTERS' | 'EXECUTION'> = {
  KELLY_FRACTION: 'RISK',
  MAX_POSITION_PCT: 'RISK',
  MAX_TOTAL_EXPOSURE_PCT: 'RISK',
  MIN_TRADE_SIZE_USDC: 'RISK',
  MAX_TRADE_SIZE_USDC: 'RISK',
  MAX_DAILY_LOSS_PCT: 'RISK',
  MAX_MONTHLY_LOSS_PCT: 'RISK',
  MAX_DRAWDOWN_PCT: 'RISK',
  TOTAL_LOSS_HALT_PCT: 'RISK',
  MAX_CONSECUTIVE_LOSSES: 'RISK',
  STOP_LOSS_PCT: 'EXITS',
  TAKE_PROFIT_PCT: 'EXITS',
  TRAILING_STOP_PCT: 'EXITS',
  TIME_BASED_EXIT_HOURS: 'EXITS',
  MIN_PROFIT_THRESHOLD_PCT: 'EXITS',
  MIN_VOLUME_USDC: 'MARKET_FILTERS',
  MIN_LIQUIDITY_USDC: 'MARKET_FILTERS',
  MIN_PROBABILITY: 'MARKET_FILTERS',
  MAX_PROBABILITY: 'MARKET_FILTERS',
  MAX_SPREAD_PCT: 'MARKET_FILTERS',
  MIN_TIME_TO_EXPIRY_HOURS: 'MARKET_FILTERS',
  MAX_TIME_TO_EXPIRY_DAYS: 'MARKET_FILTERS',
  SLIPPAGE_TOLERANCE_PCT: 'EXECUTION',
  GAS_PRIORITY_GWEI: 'EXECUTION',
  GAS_MAX_GWEI: 'EXECUTION',
  ORDER_COOLDOWN_SECONDS: 'EXECUTION',
  MAX_ORDERS_PER_MINUTE: 'EXECUTION',
};

const buildValues = (): Record<SettingsKey, number> => {
  const snapshot: Partial<Record<SettingsKey, number>> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as SettingsKey[]) {
    const section = (CONFIG as any)[KEY_TO_SECTION[key]] as Record<string, number>;
    snapshot[key] = section[key];
  }
  return snapshot as Record<SettingsKey, number>;
};

const isPctKey = (key: SettingsKey) => key.endsWith('_PCT') || key.includes('PCT');
const formatValue = (key: SettingsKey, value: number) => {
  if (isPctKey(key)) return `${(value * 100).toFixed(2)}%`;
  return value.toString();
};

const TradeSettingsPanel: React.FC<TradeSettingsPanelProps> = ({ initial, onApply, open, onClose, logger }) => {
  const [values, setValues] = useState<Record<SettingsKey, number>>(() => buildValues());

  useEffect(() => {
    if (open === false) return;
    setValues(buildValues());
  }, [initial, open]);

  const syncToConfig = (key: SettingsKey, raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    const clamped = applySetting(key, num, logger);
    setValues(prev => ({ ...prev, [key]: clamped }));
    const section = KEY_TO_SECTION[key];
    const mapped = {
      entryWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS,
      exitWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS,
      kellyFraction: CONFIG.RISK.KELLY_FRACTION,
      maxPositionPct: CONFIG.RISK.MAX_POSITION_PCT,
      stopLossPct: CONFIG.EXITS.STOP_LOSS_PCT,
      takeProfitPct: CONFIG.EXITS.TAKE_PROFIT_PCT,
      maxDailyLoss: CONFIG.RISK.MAX_DAILY_LOSS,
      maxDrawdown: CONFIG.RISK.MAX_DRAWDOWN,
    } as Partial<TradeSettings>;

    if (section === 'RISK' && key === 'KELLY_FRACTION') mapped.kellyFraction = clamped;
    if (section === 'RISK' && key === 'MAX_POSITION_PCT') mapped.maxPositionPct = clamped;
    if (section === 'EXITS' && key === 'STOP_LOSS_PCT') mapped.stopLossPct = clamped;
    if (section === 'EXITS' && key === 'TAKE_PROFIT_PCT') mapped.takeProfitPct = clamped;
    if (section === 'RISK' && key === 'MAX_DAILY_LOSS_PCT') mapped.maxDailyLoss = CONFIG.RISK.MAX_DAILY_LOSS;
    if (section === 'RISK' && key === 'MAX_DRAWDOWN_PCT') mapped.maxDrawdown = CONFIG.RISK.MAX_DRAWDOWN;
    onApply(mapped);
  };

  const handleReset = () => {
    resetSettings(logger);
    setValues(buildValues());
    onApply({
      entryWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS,
      exitWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS,
      kellyFraction: CONFIG.RISK.KELLY_FRACTION,
      maxPositionPct: CONFIG.RISK.MAX_POSITION_PCT,
      stopLossPct: CONFIG.EXITS.STOP_LOSS_PCT,
      takeProfitPct: CONFIG.EXITS.TAKE_PROFIT_PCT,
      maxDailyLoss: CONFIG.RISK.MAX_DAILY_LOSS,
      maxDrawdown: CONFIG.RISK.MAX_DRAWDOWN,
    });
  };

  const handleApply = () => {
    onApply({
      entryWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.ENTRY_WINDOW_MS,
      exitWindowMs: CONFIG.STRATEGIES.BOT_EXHAUSTION.EXIT_WINDOW_MS,
      kellyFraction: CONFIG.RISK.KELLY_FRACTION,
      maxPositionPct: CONFIG.RISK.MAX_POSITION_PCT,
      stopLossPct: CONFIG.EXITS.STOP_LOSS_PCT,
      takeProfitPct: CONFIG.EXITS.TAKE_PROFIT_PCT,
      maxDailyLoss: CONFIG.RISK.MAX_DAILY_LOSS,
      maxDrawdown: CONFIG.RISK.MAX_DRAWDOWN,
    });
    onClose?.();
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.96))',
        color: '#e5e7eb',
        borderLeft: '1px solid rgba(148,163,184,0.22)',
        boxShadow: '-12px 0 32px rgba(2,6,23,0.55)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        overflow: 'hidden',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          padding: '14px 18px 12px',
          borderBottom: '1px solid rgba(148,163,184,0.18)',
          background: 'rgba(15,23,42,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.4, color: '#f8fafc' }}>TRADE SETTINGS</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Changes apply on the next tick. Paper mode unaffected.</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'rgba(15,23,42,0.7)',
              border: '1px solid rgba(148,163,184,0.24)',
              color: '#e2e8f0',
              borderRadius: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              fontSize: 11,
              boxShadow: '0 0 0 1px rgba(148,163,184,0.08)',
            }}
          >
            Close
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 96px' }}>
        {SECTION_ORDER.map((section) => (
          <div key={section.title} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: section.accent, boxShadow: `0 0 12px ${section.accent}` }} />
              <span style={{ fontSize: 11, letterSpacing: 0.6, fontWeight: 700, color: section.accent, textTransform: 'uppercase' }}>{section.title}</span>
            </div>

            {section.keys.map((key) => {
              const spec = SETTINGS_SCHEMA[key];
              const val = values[key];
              const helpText = 'help' in spec ? spec.help : undefined;
              return (
                <div
                  key={key}
                  style={{
                    marginBottom: 12,
                    padding: '10px 10px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.12)',
                    background: 'rgba(15,23,42,0.4)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                    <span style={{ color: '#dbeafe' }}>{spec.label}</span>
                    <span style={{ color: '#f8fafc', fontWeight: 700 }}>{formatValue(key, val)}</span>
                  </div>
                  <input
                    type="range"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={val}
                    onChange={(e) => syncToConfig(key, e.target.value)}
                    style={{ width: '100%', accentColor: section.accent, cursor: 'pointer' }}
                  />
                  {helpText && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>{helpText}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '12px 18px 14px',
          borderTop: '1px solid rgba(148,163,184,0.18)',
          background: 'rgba(2,6,23,0.88)',
          backdropFilter: 'blur(14px)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          boxShadow: '0 -10px 30px rgba(2,6,23,0.6)',
        }}
      >
        <button
          onClick={handleReset}
          style={{
            background: 'rgba(15,23,42,0.9)',
            border: '1px solid rgba(248,113,113,0.25)',
            color: '#fca5a5',
            borderRadius: 8,
            padding: '7px 12px',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
        <Button onClick={handleApply} size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:opacity-90">
          <Save className="h-3 w-3 mr-1" /> Apply
        </Button>
      </div>
    </div>
  );
};

export default TradeSettingsPanel;
