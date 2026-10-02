import { createOpenAI } from "npm:@ai-sdk/openai";
import { streamText } from "npm:ai";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lovable-aig-run-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Lovable-AIG-Run-ID",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, "Content-Type": "application/json" } });

const SYSTEM = `You are a Polymarket CLOB order troubleshooting assistant for a trading bot operator.
Given an order rejection message and order details, explain the most likely cause and recommend a SAFE next step.
Know common Polymarket CLOB causes: invalid signature / signer-maker mismatch, wrong signatureType or funder, missing or expired L2 API credentials (key/secret/passphrase), insufficient USDC balance or allowance to the exchange contract, tick size violations, minimum order size, price outside 0-1, expired or invalid expiration, nonce issues, market closed/resolved, neg-risk exchange mismatch, FOK/FAK not fillable, rate limits, geoblocking.
Rules: never ask for or repeat private keys, secrets or passphrases. Never recommend increasing size, leverage, or retrying blindly. Prefer staying in paper mode until the issue is verified.
Respond ONLY with JSON (no markdown fences) of shape:
{"likely_cause": string, "confidence": "low"|"medium"|"high", "explanation": string, "safe_next_step": string, "checks": string[] (up to 5 short items), "retry_safe": boolean}
Keep the whole answer under 250 words.`;

const SECRET_RE = /(0x[0-9a-fA-F]{64})|("?(secret|passphrase|private_?key|api_?key)"?\s*[:=]\s*"?[^",\s}]+)/gi;
const redact = (s: string) => s.replace(SECRET_RE, "[REDACTED]");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await supa.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "Please sign in to use this feature." }, 401);

  let body: { message?: string; details?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const message = String(body.message ?? "").trim().slice(0, 4000);
  const details = String(body.details ?? "").trim().slice(0, 8000);
  if (!message) return json({ error: "Rejection message is required" }, 400);

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured" }, 500);

  let runId: string | undefined = req.headers.get("X-Lovable-AIG-Run-ID")?.trim() || undefined;
  let upstreamStatus = 0;
  let upstreamMsg = "";
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const h = new Headers(init?.headers);
      if (runId) h.set("X-Lovable-AIG-Run-ID", runId);
      const r = await fetch(input, { ...init, headers: h });
      runId ??= r.headers.get("X-Lovable-AIG-Run-ID") ?? undefined;
      if (!r.ok) {
        upstreamStatus = r.status;
        try { const j = await r.clone().json(); upstreamMsg = j?.error?.message ?? j?.message ?? ""; } catch { /* ignore */ }
      }
      return r;
    },
  });

  try {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      system: SYSTEM,
      prompt: `Rejection message:\n${redact(message)}\n\nOrder details:\n${redact(details) || "(none provided)"}`,
      abortSignal: req.signal,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const text = (await result.text).trim();
    const extra = runId ? { "X-Lovable-AIG-Run-ID": runId } : {};
    if (!text) return json({ error: "The AI returned no answer for this request." }, 502, extra);
    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()); }
    catch { parsed = { likely_cause: "See explanation", confidence: "low", explanation: text, safe_next_step: "Stay in paper mode and review the explanation.", checks: [], retry_safe: false }; }
    return json({ analysis: parsed }, 200, extra);
  } catch (e) {
    if (req.signal.aborted) return json({ error: "Cancelled" }, 499);
    const status = upstreamStatus || 500;
    const msg = upstreamMsg ||
      (status === 402 ? "AI credits are used up. Add credits in workspace billing to continue."
        : status === 429 ? "Too many requests. Please wait a moment and try again."
        : "AI analysis failed.");
    console.error("explain-order-rejection", status, String(e));
    return json({ error: msg }, status);
  }
});
