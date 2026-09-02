# Plan: Enhanced Nonce Race Defender Integration

## Goal
Extend the existing browser-safe `nonce-race-defender.ts` into an **Enhanced Nonce Race Defender** matching the user's architecture: an event-driven defender with counter-exploit opportunities, self-healing patches, and an async `validateAndExecuteTrade` gate — fully wired into `NeuralBotEngine`.

## Current state (verified)
- `src/lib/nonce-race-defender.ts` already exists with tick ingestion, attack detection (NONCE_RACE, GHOST_FILL, CANCEL_FLOOD, MULTI_MARKET, BTC_MANIPULATION), a synchronous `validateOrder` gate, blacklist, counter-exploit profit accumulator, CSV export, and a singleton export.
- `NeuralBotEngine` calls `nonceDefender.ingestTick(...)` every tick and gates arbitrage/swarm orders via `validateOrder`, recording blocked rows in `arb_execution_audit`.
- `DefensePanel.tsx` renders status, attacks, manipulation signals, and the event log, reachable from the navbar.

## Changes

### 1. `src/lib/nonce-race-defender.ts` — event system + new APIs
- Add a typed event emitter (`on`/`off`, browser-safe listener map — no node `events`) with events:
  - `opportunity_ready` → `CounterOpportunity { id, attackType, marketId(s), expectedProfit, confidence, attackerAddress }`
  - `patch_applied` → `SelfHealingPatch { id, patchType, vulnerability, appliedAt, detail }`
- On confirmed attacks (existing `handleAttack`), emit `opportunity_ready` for NONCE_RACE/GHOST_FILL/MULTI_MARKET instead of silently accumulating counter profit; keep the accumulator as fallback.
- Add **self-healing patch engine**: recurring attack types (same type ≥3 in a window) auto-generate a patch (e.g. raise validation threshold, extend HEDGE_DELAY, tighten spoof cutoff) and emit `patch_applied`; patches adjust `DEFENSE_PARAMS`-derived runtime values and appear in the defense log.
- Add async `validateAndExecuteTrade(order, counterpartyAddress, capital): Promise<{ shouldExecute, waitMs, reason?, opportunity? }>` that wraps `validateOrder`, applies the suggested wait, and returns a normalized execution decision. `validateOrder` stays for sync callers.
- Optional config: constructor accepts `{ polygonRpcUrl?, blocknativeApiKey? }`; Blocknative key is read at runtime from the `/__config` proxy (per credential rules) — never hardcoded. When absent, defender runs in passive mempool mode (current heuristics).

### 2. `src/lib/neural-bot-engine.ts` — wire the new APIs
- Subscribe in the engine setup: on `opportunity_ready`, log to the terminal (`Counter-Exploit Opportunity: $X`) and route through `runArbitrageAndSwarm`'s audit path (`source: 'counter_exploit'`, action `signal`).
- On `patch_applied`, emit a `strategy` log entry and apply patch adjustments to engine trade settings where relevant (e.g. temporary hedge delay on future orders).
- Switch the arbitrage pre-trade gate from `validateOrder` to `validateAndExecuteTrade`, honoring `waitMs` before executing instead of dropping the signal outright.
- Keep all defender calls try/catch-isolated so defense errors never break the trading loop.

### 3. `src/components/DefensePanel.tsx` — surface the new features
- New "Counter-Exploit Opportunities" section: list of emitted opportunities with expected profit, confidence, attack type.
- New "Self-Healing Patches" section: patch history with type, vulnerability, applied time.
- Status row gains mempool mode (private/passive) and patch count; existing CSV export includes opportunities and patches.

## Technical notes
- No node built-ins; emitter implemented with a `Set` of handlers per event key.
- No real chain RPC calls in the browser sandbox — `polygonRpcUrl`/`blocknativeApiKey` are accepted and plumbed for future proxy use, with graceful fallback.
- Existing defense panel, audit logging, and gating behavior remain backward compatible.

## Verification
- Typecheck/build clean.
- Drive the preview: confirm defense panel shows opportunities/patches, engine log prints counter-exploit and patch lines, blocked orders still appear in the audit log with reasons.
