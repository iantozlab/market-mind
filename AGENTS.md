# AGENTS.md

## Running in Base44
- `docker compose -f docker-compose.base44.yml up -d` — single `web` service (node:22, Vite dev on 8080 → host 3000, source bind-mounted, node_modules in a named volume).
- There is no local backend: the frontend talks to the **hosted** Supabase project `buvepdnnsurgfthtgtyz` (URL/ID are public, in `.env.base44-defaults`). Edge functions (`supabase/functions/*`) and their Polymarket/Polygon secrets live in that Supabase project, not here; the edge function URL is also hardcoded in `src/lib/neural-bot-engine.ts` and `src/lib/polyswarm-integrator.ts`.
- `VITE_SUPABASE_PUBLISHABLE_KEY` comes from `/run/base44/app.env`. With the generated dev placeholder, the auth page renders but sign-in fails. Vite reads env at startup — restart `web` after it changes.
- `/` is wrapped in `AuthGate`; the dashboard is only visible after Supabase sign-in.
- `vite.config.ts` has `allowedHosts: true` so the preview proxy host is accepted.
- `.gitignore` ignores `.env.*`; `.env.base44-defaults` is whitelisted explicitly.

## Tests
- `docker compose -f docker-compose.base44.yml exec web npx vitest run`
