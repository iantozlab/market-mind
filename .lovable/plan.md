## Goal
Major dashboard restructure with diagnostics, navbar, Supabase audit persistence, theming, and strategy verification fixes.

## Changes

### 1. New Navbar (`src/components/AppNavbar.tsx`)
- Top bar with: Dashboard logo/title, nav items (Trade Settings, ML Insights, Risk Management, Strategy Backtest, Active Strategies), alerts bell icon (with unread count), theme toggle (dark/light).
- Each nav item opens a slide-out `Sheet` containing the corresponding panel (keeps homepage clean).
- "Active Strategies" opens a dropdown listing all strategies with active/inactive badges.

### 2. Theme Toggle
- Add `next-themes` style toggle using existing CSS vars; add `light` mode tokens to `index.css`.
- Persist in localStorage; toggle via Sun/Moon icon in navbar.

### 3. Alerts Center
- New `useAlertsCenter` hook collecting deprecation alerts, risk threshold breaches, cooldown events.
- Bell icon with badge count; popover lists recent alerts.

### 4. Homepage cleanup (`src/pages/Index.tsx`)
- Remove inline TradeSettings, MLInsights, Backtest, full RiskDashboard, SettingsAudit panels from grid.
- Replace Risk panel with compact `RiskAlertsPanel` showing only threshold breaches & cooldown status (drawdown hit, daily loss limit, position cap, cooldown timer).
- Keep: MarketList, PsychologyHealthPanel, Diagnostics panel (new), TerminalLog, NeuralStatusCard, MetricCards.

### 5. Diagnostics Panel (`src/components/PsychologyDiagnosticsPanel.tsx`)
- Engine emits a `signalRouted` event with `{signalType, healthKey, timestamp, metrics}`.
- Panel shows live table: signal type → health key updated, count, last seen, trigger metrics snippet.
- Confirms mapping fix (temporal_entry → temporal_decay etc.).

### 6. "Why Active" Explanations
- Engine tracks `lastTrigger` per strategy: `{reason, metrics, timestamp}`.
- Surface in `StrategyDetailDrawer` and as tooltip in `PsychologyHealthPanel` rows.

### 7. Supabase Audit Log
- New table `trade_settings_audit` (actor, changes JSONB, created_at) with public RLS for read/insert.
- Update `settings-audit.ts` to write to Supabase + keep localStorage mirror.
- `SettingsAuditPanel` queries with date range filter (last 24h, 7d, 30d, all).

### 8. Backtest metadata enrichment
- Capture full snapshot of live `TradeSettings` at run time; include all fields in PDF summary block and CSV column suffix.

### 9. Cooldown / risk threshold engine
- Engine: when drawdown ≥ maxDrawdown OR dailyPnL ≤ -maxDailyLoss, set `cooldownUntil` (e.g., +15 min) and pause new entries.
- Emit alerts; expose `getCooldownStatus()`.

### 10. Strategy activation guarantee
- Audit `neural-bot-engine.ts` tick loop: ensure all strategies (whale_wreckage, convergence_fade, governance_attack, temporal_decay, bot_exhaustion, liquidity_provision, zk_exploit, whale_inactivity, pre_event, anchor_reversion) execute every tick when bot running.
- Add health key initialization at start so all strategies appear (not just active ones).
- Log activation in diagnostics panel.

## Database Migration
```sql
CREATE TABLE public.trade_settings_audit (
  id uuid PK default gen_random_uuid(),
  actor text NOT NULL,
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL default now()
);
ALTER TABLE ... ENABLE RLS;
-- public read/insert/delete policies
CREATE INDEX ON trade_settings_audit (created_at DESC);
```

## Files
- **New**: `AppNavbar.tsx`, `ThemeToggle.tsx`, `AlertsBell.tsx`, `PsychologyDiagnosticsPanel.tsx`, `RiskAlertsPanel.tsx`, `ActiveStrategiesMenu.tsx`, `hooks/useTheme.ts`, `hooks/useAlertsCenter.ts`
- **Edit**: `Index.tsx`, `neural-bot-engine.ts`, `market-psychology-engine.ts`, `settings-audit.ts`, `SettingsAuditPanel.tsx`, `StrategyDetailDrawer.tsx`, `PsychologyHealthPanel.tsx`, `BacktestPanel.tsx`, `index.css`, `App.tsx`
- **Migration**: `trade_settings_audit` table