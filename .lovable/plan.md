## Goal
Add structured JSON logging to `supabase/functions/polymarket-proxy/index.ts` so we can debug upstream 401/404 errors (and other non-2xx responses) by inspecting edge function logs.

## Changes

Single file: `supabase/functions/polymarket-proxy/index.ts`

1. **Per-request log context** — generate a short `requestId` (random) and capture `endpoint`, `params`, `method`, `targetUrl`, `isGamma`, and start time.

2. **Request log (info)** — emit one `console.log(JSON.stringify({...}))` line on entry with: `level: "info"`, `event: "upstream_request"`, `requestId`, `endpoint`, `method`, `params` (truncated to 500 chars), `targetUrl`.

3. **Response log** —
   - On 2xx: `console.log` with `event: "upstream_response"`, `status`, `durationMs`, `bodyBytes`.
   - On 401/403/404/429/5xx: `console.warn`/`console.error` with `event: "upstream_error"`, `status`, `durationMs`, `bodySnippet` (first 500 chars of upstream body), plus the request context (endpoint, params, targetUrl). This is the key change — today we wrap errors in the JSON envelope but never log the upstream body, so 401/404 details vanish.

4. **Exception log** — in the `catch` block, `console.error` with `event: "proxy_exception"`, `requestId`, `errorMessage`, `errorName`, plus request context. Distinguish `AbortError` (timeout) with `event: "upstream_timeout"`.

5. **Disallowed/invalid input logs** — `console.warn` when `endpoint` missing or path not allowed, including the offending value.

6. **Config endpoint** — log `event: "config_request"` with which env vars are present (booleans only, never values).

## Non-goals
- No behavior changes to the response envelope returned to the client.
- No new env vars, no log-level config, no external log sink.
- No changes to `neural-bot-engine.ts` or other client code.

## Verification
After deploy, trigger the bot, then use `supabase--edge_function_logs` (function `polymarket-proxy`) to confirm `upstream_error` entries appear with the actual 401 message body and the `targetUrl`/`params` that produced it.
