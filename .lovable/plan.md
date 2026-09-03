# Finish Enhanced Nonce Race Defender wiring

## Verified current state
- `src/lib/nonce-race-defender.ts` (516 lines) already has: the `EnhancedNonceRaceDefender` class, typed emitter map + `on()`/`emitEvent()`, `CounterOpportunity`/`SelfHealingPatch` types, `opportunities`/`patches`/`recentAttackTypes` arrays, getters, `mempoolMode`/`patchesApplied` in `getStatus()`, and runtime knobs `rtHedgeDelayMs`/`rtSpoofCutoff`/`rtOrderCapRatio`.
- Not yet done in the lib: `handleAttack` still only accumulates counter profit (no `opportunity_ready` emit), no self-healing patch generation/`patch_applied` emit, no `validateAndExecuteTrade`, and `validateOrder` still uses hardcoded `0.3` / `0.7` / `HEDGE_DELAY_MS` instead of the `rt*` values.
- `neural-bot-engine.ts` calls `ingestTick` (line 1610) and the sync `validateOrder` gate (line 954); no event subscriptions.
- `DefensePanel.tsx` has Attacks / Manipulation / Log / Blacklist tabs only.

## Remaining work

### 1. `src/lib/nonce-race-defender.ts`
- In `handleAttack`: build a `CounterOpportunity` for NONCE_RACE / GHOST_FILL / MULTI_MARKET, push to `opportunities` (cap 50), log it (`kind: 'opportunity'`), keep the profit accumulator, and `emitEvent('opportunity_ready', …)`.
- Record every attack in `recentAttackTypes`; when the same type occurs 3+ times within 5 minutes, generate a `SelfHealingPatch` that adjusts the matching runtime knob (raise `rtSpoofCutoff` tightening, extend `rtHedgeDelayMs`, lower `rtOrderCapRatio`), push + log it (`kind: 'patch'`), and `emitEvent('patch_applied', …)`. One patch per vulnerability type per window.
- Use `rtOrderCapRatio`, `rtSpoofCutoff`, `rtHedgeDelayMs` inside `validateOrder` instead of the literals.
- Add `async validateAndExecuteTrade(order, counterpartyAddress, capital): Promise<TradeExecutionDecision>` wrapping `validateOrder`, returning `{ shouldExecute, waitMs, reason, requiresManualVerification }` and attaching the newest matching opportunity when present.
- Extend `toCsv()` with opportunity and patch rows.

### 2. `src/lib/neural-bot-engine.ts`
- In engine setup, subscribe once to both defender events (try/catch isolated):
  - `opportunity_ready` → terminal log line `Counter-Exploit Opportunity: $X (TYPE, conf%)` plus an audit row `source: 'counter_exploit'`, `action: 'signal'`.
  - `patch_applied` → `strategy` log entry describing the patch.
  - Dispose subscriptions on engine stop/cleanup.
- Replace the sync `validateOrder` arb gate with `await validateAndExecuteTrade(...)`, honoring `waitMs` (delay then skip the tick rather than silently dropping), still writing blocked rows to `arb_execution_audit` with the gate reason.

### 3. `src/components/DefensePanel.tsx`
- Add "Opportunities" and "Patches" tabs listing expected profit / confidence / attack type and patch type / vulnerability / applied time.
- Add mempool-mode and patches-applied stats to the status grid; CSV export picks up the new rows automatically.

## Verification
- `tsgo` typecheck clean; run existing vitest suite.
- Drive the preview with Playwright: open the Defense sheet, confirm the new tabs and stats render, and confirm no console errors while the engine runs.
