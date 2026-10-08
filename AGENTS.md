# Base44 Dev Environment

## Project Overview
Vite + React + TypeScript + Supabase (Lovable-generated). Uses npm (package-lock.json present).
Dev server runs on port 8080 inside the container, mapped to host port 3000.

## Setup
- `docker compose -f docker-compose.base44.yml up -d` starts the dev server.
- Dependencies install on container startup via `npm install`.
- Source is bind-mounted; Vite live-reload is active.

## Key Fixes Applied
1. **Vite host blocking**: Vite 5.4.19 has `allowedHosts` security checking that blocks the preview's proxy hostname. Fixed by adding `allowedHosts: true` to `server` config in `vite.config.ts`.
2. **Supabase env var override**: The compose `environment:` section was passing empty host values for `VITE_SUPABASE_*` vars, overriding the defaults from `env_file` and causing `supabaseUrl is required` runtime error. Fixed by removing those vars from `environment:` — they now come only from `env_file` (defaults first, platform secrets last).
3. **Real market data via direct Polymarket API**: The `RealTimeDataFetcher` previously routed all API calls through the Supabase edge function proxy (`polymarket-proxy`), which requires a deployed Supabase project. With placeholder credentials the proxy fails and the bot falls back to `generateSimulatedMarkets()`. Fixed by making the data fetcher call Polymarket's public APIs directly (`gamma-api.polymarket.com/markets`, `clob.polymarket.com/book`) — both are CORS-enabled with `Access-Control-Allow-Origin: *`. The proxy is still used for authenticated order submission. Also increased the number of markets that get real order books from 5 to 20 per tick.

## Environment Variables
- `VITE_SUPABASE_URL` — Supabase project URL (placeholder in `.env.base44-defaults`, user should replace)
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase anon key (delivered via `/run/base44/app.env`)
- `VITE_SUPABASE_PROJECT_ID` — Supabase project ID (placeholder in `.env.base44-defaults`)

## Verification
- `curl -H "Host: 3000-test.e2b.app" http://localhost:3000/` returns 200 (host check passes)
- `docker compose -f docker-compose.base44.yml exec -T web npx vite build` succeeds
- Preview loads with 0 console errors and renders content

## Notes
- The `supabase/functions/` directory contains Deno edge functions — not part of the Vite build.
- The `sign-polymarket-order/index.ts` edge function has `}      const admin` on one line — this is valid JS (block close + new statement), not a syntax error.
