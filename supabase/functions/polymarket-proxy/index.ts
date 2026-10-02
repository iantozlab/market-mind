import { createClient } from "npm:@supabase/supabase-js@2";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLOB_BASE = "https://clob.polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";

const ALLOWED_PATHS = [
  "/markets", "/gamma/markets", "/gamma/events", "/book", "/trades",
  "/trades/recent", "/orderbook/summary", "/markets/trending", "/orders", "/__config",
];

function logJson(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function getPrivateKey(): `0x${string}` {
  const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY");
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("POLYMARKET_PRIVATE_KEY is not configured correctly");
  }
  return privateKey as `0x${string}`;
}

function decodeBase64Secret(secret: string): Uint8Array {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function createClobSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64Secret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `${timestamp}POST/order${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_");
}

async function secureSubmitOrder(signedOrderPayload: Record<string, unknown>) {
  const privateKey = getPrivateKey();
  const account = privateKeyToAccount(privateKey);
  const apiKey = Deno.env.get("POLYMARKET_API_KEY");
  const secret = Deno.env.get("POLYMARKET_SECRET");
  const passphrase = Deno.env.get("POLYMARKET_PASSPHRASE");
  if (!apiKey || !secret || !passphrase) throw new Error("Polymarket API credentials are not configured");

  if (signedOrderPayload.maker !== account.address || signedOrderPayload.signer !== account.address) {
    throw new Error("Signed order address does not match the configured signer");
  }
  const salt = Number(signedOrderPayload.salt);
  if (!Number.isSafeInteger(salt) || salt <= 0) throw new Error("Order salt must be a positive safe integer");
  if (typeof signedOrderPayload.signature !== "string" || !/^0x[0-9a-f]+$/i.test(signedOrderPayload.signature)) {
    throw new Error("Signed order signature is invalid");
  }

  const order = {
    builder: String(signedOrderPayload.builder),
    expiration: "0",
    maker: account.address,
    makerAmount: String(signedOrderPayload.makerAmount),
    metadata: String(signedOrderPayload.metadata),
    salt,
    side: Number(signedOrderPayload.side) === 0 ? "BUY" : "SELL",
    signature: signedOrderPayload.signature,
    signatureType: Number(signedOrderPayload.signatureType),
    signer: account.address,
    takerAmount: String(signedOrderPayload.takerAmount),
    timestamp: String(signedOrderPayload.timestamp),
    tokenId: String(signedOrderPayload.tokenId),
  };
  const body = JSON.stringify({ deferExec: false, order, orderType: "FAK", owner: apiKey });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await createClobSignature(secret, timestamp, body);
  const response = await fetch(`${CLOB_BASE}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      POLY_ADDRESS: account.address,
      POLY_API_KEY: apiKey,
      POLY_PASSPHRASE: passphrase,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
    },
    body,
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`CLOB submission failed: ${response.status} ${responseBody}`);
  const result = JSON.parse(responseBody) as Record<string, unknown>;
  if (result.success !== true) throw new Error(`CLOB rejected order: ${String(result.errorMsg ?? "unknown reason")}`);
  return result;
}

async function proxyRequest(endpoint: string, params: string | undefined, method: string, requestBody: unknown) {
  const isGamma = endpoint.startsWith("/gamma/");
  const upstreamPath = isGamma ? endpoint.replace("/gamma", "") : endpoint;
  const base = isGamma ? GAMMA_BASE : CLOB_BASE;
  const targetUrl = `${base}${upstreamPath}${params ? `?${params}` : ""}`;
  const apiKey = Deno.env.get("POLYMARKET_API_KEY");
  const secret = Deno.env.get("POLYMARKET_SECRET");
  const passphrase = Deno.env.get("POLYMARKET_PASSPHRASE");
  const hasCreds = !!(apiKey && secret && passphrase);
  // Public market data (GET) works without credentials; only writes require them.
  if (!hasCreds && method === "POST") throw new Error("Polymarket API credentials are not configured");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (hasCreds && !isGamma) {
    headers["POLYMARKET-API-KEY"] = apiKey!;
    headers["POLYMARKET-SECRET"] = secret!;
    headers["POLYMARKET-PASSPHRASE"] = passphrase!;
  }
  const response = await fetch(targetUrl, {
    method: method === "HEAD" ? "HEAD" : method === "POST" ? "POST" : "GET",
    headers,
    body: method === "POST" && requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

async function isAdminRequest(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return false;
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data } = await svc.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let endpoint = "";
  try {
    const input = await req.json() as { endpoint?: string; params?: string; method?: string; body?: unknown };
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.endpoint !== "string" || input.endpoint.length === 0 || input.endpoint.length > 256 ||
      (input.params !== undefined && (typeof input.params !== "string" || input.params.length > 4096)) ||
      (input.method !== undefined && typeof input.method !== "string")) {
      return new Response(JSON.stringify({ error: "Invalid proxy request" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    endpoint = input.endpoint;
    const method = input.method ?? "GET";
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (endpoint === "/__config") {
      if (method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      );
      const { data: { user }, error } = await authClient.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        polygonRpcUrl: !!Deno.env.get("POLYGON_RPC_URL"),
        blocknativeApiKey: !!Deno.env.get("BLOCKNATIVE_API_KEY"),
        polymarketApiKey: !!Deno.env.get("POLYMARKET_API_KEY"),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const canonicalEndpoint = new URL(endpoint, "https://proxy.invalid");
    const hasSafePath = endpoint.startsWith("/") &&
      canonicalEndpoint.origin === "https://proxy.invalid" &&
      canonicalEndpoint.pathname === endpoint &&
      !endpoint.includes("%") &&
      !endpoint.includes("\\");
    if (!hasSafePath || !ALLOWED_PATHS.some((path) => endpoint === path || endpoint.startsWith(`${path}/`))) {
      return new Response(JSON.stringify({ error: "Endpoint not allowed" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (endpoint.startsWith("/orders") || (method !== "GET" && method !== "HEAD")) {
      if (!(await isAdminRequest(req))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (endpoint === "/orders" && method === "POST") {
      if (!input.body || typeof input.body !== "object") throw new Error("Missing signed order payload");
      const result = await secureSubmitOrder(input.body as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, status: 200, body: JSON.stringify(result) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await proxyRequest(endpoint, input.params, method, input.body);
    if (method === "HEAD") {
      return new Response(JSON.stringify({ ok: result.ok, status: result.status, body: "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    logJson("error", { event: "proxy_exception", endpoint, errorName: error instanceof Error ? error.name : "UnknownError" });
    return new Response(JSON.stringify({ error: "Proxy request failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
