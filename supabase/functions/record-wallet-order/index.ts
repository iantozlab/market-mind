// Saves an order that the admin signed in their own browser wallet and sent
// to Polymarket from their own connection. Stores Polymarket's exact reply.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Body = z.object({
  tokenId: z.string().regex(/^\d{1,90}$/),
  side: z.enum(["BUY", "SELL"]),
  price: z.number().gt(0).lt(1),
  size: z.number().gt(0).max(10000),
  orderType: z.enum(["GTC", "FAK", "FOK"]),
  marketLabel: z.string().max(300).optional(),
  retryOf: z.string().uuid().optional(),
  status: z.string().max(40),
  httpStatus: z.number().int().min(0).max(999).nullable(),
  response: z.unknown(),
  errorMessage: z.string().max(2000).nullable(),
  orderId: z.string().max(200).nullable(),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!).auth.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await svc.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isAdmin !== true) return json({ error: "Only the admin account can record live orders." }, 403);

  let b: z.infer<typeof Body>;
  try {
    const p = Body.safeParse(await req.json());
    if (!p.success) return json({ error: "Invalid record", details: p.error.flatten().fieldErrors }, 400);
    b = p.data;
  } catch { return json({ error: "Invalid request body" }, 400); }

  const { data, error } = await svc.from("order_audit_log").insert({
    user_id: user.id, mode: "live", market_label: b.marketLabel ?? null, token_id: b.tokenId,
    side: b.side, price: b.price, size: b.size, order_type: b.orderType, retry_of: b.retryOf ?? null,
    status: b.status, http_status: b.httpStatus, error_message: b.errorMessage, order_id: b.orderId,
    polymarket_response: { source: "browser_wallet", wallet: b.wallet, reply: b.response ?? null },
  }).select().single();
  if (error) return json({ error: "Could not save order" }, 500);
  return json({ order: data });
});
