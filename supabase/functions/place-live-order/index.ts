// Places a REAL Polymarket order server-side (sign + submit), and records the
// exact Polymarket response in order_audit_log. Admin-only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";
import { z } from "npm:zod@3.23.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const CLOB = "https://clob.polymarket.com";
const STANDARD_EXCHANGE = "0xE111180000d2663C0091e4f400237545B87B996B";
const NEG_RISK_EXCHANGE = "0xe2222d279d744050d28e00520010520000310F59";
const ZERO32 = `0x${"0".repeat(64)}` as const;
const TYPES = {
  Order: [
    { name: "salt", type: "uint256" }, { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" }, { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" }, { name: "timestamp", type: "uint256" },
    { name: "metadata", type: "bytes32" }, { name: "builder", type: "bytes32" },
  ],
} as const;

const Body = z.object({
  tokenId: z.string().regex(/^\d{1,90}$/),
  side: z.enum(["BUY", "SELL"]),
  price: z.number().gt(0).lt(1),
  size: z.number().gt(0).max(10000),
  orderType: z.enum(["GTC", "FAK", "FOK"]).default("GTC"),
  marketLabel: z.string().max(300).optional(),
  retryOf: z.string().uuid().optional(),
});

function b64(secret: string) {
  const n = secret.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(n.padEnd(Math.ceil(n.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", b64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user } } = await anon.auth.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await svc.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isAdmin !== true) return json({ error: "Only the admin account can place live orders." }, 403);

  let input: z.infer<typeof Body>;
  try {
    const p = Body.safeParse(await req.json());
    if (!p.success) return json({ error: "Invalid order", details: p.error.flatten().fieldErrors }, 400);
    input = p.data;
  } catch { return json({ error: "Invalid request body" }, 400); }

  const pk = Deno.env.get("POLYMARKET_PRIVATE_KEY");
  const apiKey = Deno.env.get("POLYMARKET_API_KEY");
  const secret = Deno.env.get("POLYMARKET_SECRET");
  const pass = Deno.env.get("POLYMARKET_PASSPHRASE");
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk) || !apiKey || !secret || !pass) {
    return json({ error: "Polymarket trading credentials are not fully configured." }, 503);
  }
  const account = privateKeyToAccount(pk as `0x${string}`);

  const record = async (row: Record<string, unknown>) => {
    const { data } = await svc.from("order_audit_log").insert({
      user_id: user.id, mode: "live", market_label: input.marketLabel ?? null, token_id: input.tokenId,
      side: input.side, price: input.price, size: input.size, order_type: input.orderType,
      retry_of: input.retryOf ?? null, ...row,
    }).select().single();
    return data;
  };

  // Market rules from the live order book.
  let negRisk = false, tick = 0.01, minSize = 0;
  try {
    const r = await fetch(`${CLOB}/book?token_id=${input.tokenId}`);
    const book = await r.json();
    if (!r.ok) {
      const row = await record({ status: "rejected", http_status: r.status, polymarket_response: book, error_message: book?.error ?? "Order book lookup failed" });
      return json({ order: row }, 200);
    }
    negRisk = book.neg_risk === true;
    tick = Number(book.tick_size) || 0.01;
    minSize = Number(book.min_order_size) || 0;
  } catch (e) {
    const row = await record({ status: "error", error_message: `Order book lookup failed: ${String(e)}` });
    return json({ order: row }, 200);
  }
  const ticks = Math.round(input.price / tick);
  const price = +(ticks * tick).toFixed(6);
  if (Math.abs(price - input.price) > 1e-9 || price <= 0 || price >= 1) {
    const row = await record({ status: "invalid", error_message: `Price ${input.price} is not a multiple of tick size ${tick}` });
    return json({ order: row }, 200);
  }
  if (input.size < minSize) {
    const row = await record({ status: "invalid", error_message: `Size ${input.size} is below the market minimum of ${minSize}` });
    return json({ order: row }, 200);
  }

  // Amounts (6 decimals). Shares to 2 dp, USDC to 4 dp.
  const shares = Math.round(input.size * 100) / 100;
  const usdc = Math.round(shares * price * 10000) / 10000;
  const sharesU = BigInt(Math.round(shares * 1e6));
  const usdcU = BigInt(Math.round(usdc * 1e6));
  const isBuy = input.side === "BUY";
  const now = Date.now();
  const salt = Math.floor(Math.random() * 2 ** 48) + 1;
  const message = {
    salt: BigInt(salt), maker: account.address, signer: account.address,
    tokenId: BigInt(input.tokenId),
    makerAmount: isBuy ? usdcU : sharesU, takerAmount: isBuy ? sharesU : usdcU,
    side: isBuy ? 0 : 1, signatureType: 0, timestamp: BigInt(now),
    metadata: ZERO32, builder: ZERO32,
  };
  const domain = {
    name: "Polymarket CTF Exchange", version: "2", chainId: 137,
    verifyingContract: (negRisk ? NEG_RISK_EXCHANGE : STANDARD_EXCHANGE) as `0x${string}`,
  };
  const signature = await account.signTypedData({ domain, types: TYPES, primaryType: "Order", message });

  const order = {
    builder: ZERO32, expiration: "0", maker: account.address,
    makerAmount: message.makerAmount.toString(), metadata: ZERO32, salt,
    side: input.side, signature, signatureType: 0, signer: account.address,
    takerAmount: message.takerAmount.toString(), timestamp: String(now), tokenId: input.tokenId,
  };
  const body = JSON.stringify({ deferExec: false, order, orderType: input.orderType, owner: apiKey });
  const ts = Math.floor(now / 1000).toString();
  let httpStatus = 0, raw = "", parsed: unknown = null;
  try {
    const r = await fetch(`${CLOB}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        POLY_ADDRESS: account.address, POLY_API_KEY: apiKey, POLY_PASSPHRASE: pass,
        POLY_SIGNATURE: await hmac(secret, `${ts}POST/order${body}`), POLY_TIMESTAMP: ts,
      },
      body,
    });
    httpStatus = r.status;
    raw = await r.text();
    try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
  } catch (e) {
    const row = await record({ status: "error", error_message: `Network error reaching Polymarket: ${String(e)}` });
    return json({ order: row }, 200);
  }
  const p = (parsed ?? {}) as Record<string, unknown>;
  const accepted = httpStatus >= 200 && httpStatus < 300 && p.success !== false && !p.error;
  const row = await record({
    status: accepted ? String(p.status ?? "accepted") : "rejected",
    http_status: httpStatus,
    polymarket_response: parsed,
    error_message: accepted ? null : String(p.errorMsg ?? p.error ?? raw).slice(0, 2000),
    order_id: typeof p.orderID === "string" ? p.orderID : null,
  });
  console.log(JSON.stringify({ event: "live_order", status: row?.status, http: httpStatus }));
  return json({ order: row, exchange: negRisk ? "neg-risk" : "standard", signer: account.address }, 200);
});
