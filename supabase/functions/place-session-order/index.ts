import { createClient } from "npm:@supabase/supabase-js@2";
import { createSecureClient, OrderSide, OrderType } from "npm:@polymarket/client@0.12.0";
import { privateKey } from "npm:@polymarket/client@0.12.0/viem";
import { createPublicClient, formatUnits, http, isAddress, parseUnits } from "npm:viem@2.51.0";
import { polygon } from "npm:viem@2.51.0/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

const PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;
const TRADING_EXCHANGES = [
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa",
] as const;
const erc20Abi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ type: "uint256" }],
}, {
  type: "function",
  name: "allowance",
  stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function configuredAccount() {
  const wallet = Deno.env.get("POLYMARKET_DEPOSIT_WALLET") ?? "";
  const sessionPrivateKey = Deno.env.get("POLYMARKET_SESSION_PRIVATE_KEY") ?? "";
  if (!isAddress(wallet) || !/^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey)) {
    throw new Error("Deposit Wallet session signer is not configured");
  }
  return { wallet, sessionPrivateKey };
}

async function isAdminRequest(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return false;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data } = await service.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = (Deno.env.get("POLYMARKET_ALLOWED_ORIGIN") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403);
    return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin } });
  }

  const origin = req.headers.get("Origin") ?? "";
  const allowed = (Deno.env.get("POLYMARKET_ALLOWED_ORIGIN") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await isAdminRequest(req))) return json({ error: "Forbidden" }, 403);

  try {
    const { wallet, sessionPrivateKey } = configuredAccount();
    const input = await req.json();
    if (input?.action === "readiness") {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return json({ error: "Invalid amount" }, 400);
      const client = createPublicClient({ chain: polygon, transport: http() });
      const required = parseUnits(amount.toFixed(2), 6);
      const [balance, allowances] = await Promise.all([
        client.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [wallet], authorizationList: [] }),
        Promise.all(TRADING_EXCHANGES.map((spender) => client.readContract({
          address: PUSD,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, spender],
          authorizationList: [],
        }))),
      ]);
      const approvalsReady = allowances.every((allowance) => allowance >= required);
      return json({
        ready: balance >= required && approvalsReady,
        balance: formatUnits(balance, 6),
        amount: amount.toFixed(2),
        missingApprovals: allowances.flatMap((allowance, index) => allowance < required ? [TRADING_EXCHANGES[index]] : []),
        wallet,
      });
    }
    const assetId = input?.assetId;
    const amount = Number(input?.amount);
    const maxPrice = Number(input?.maxPrice);
    if (typeof assetId !== "string" || !/^\d{1,78}$/.test(assetId) ||
      !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 ||
      !Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice >= 1) {
      return json({ error: "Invalid order parameters" }, 400);
    }

    const client = await createSecureClient({
      signer: privateKey(sessionPrivateKey, { chain: polygon }),
      wallet,
    });
    const response = await client.placeMarketOrder({
      assetId,
      side: OrderSide.BUY,
      amount: amount.toFixed(2),
      maxPrice: maxPrice.toString(),
      orderType: OrderType.FAK,
    });

    if (!response.ok) {
      const rejection = response.message.toLowerCase();
      const retryable = rejection.includes("not enough balance") || rejection.includes("not enough allowance") || rejection.includes("insufficient balance") || rejection.includes("insufficient allowance");
      return json({
        success: false,
        retryable,
        ambiguous: false,
        error: response.message,
        code: response.code,
        status: response.status,
      }, 422);
    }
    return json({
      success: true,
      orderId: response.orderId,
      status: response.status,
      tradeIds: response.tradeIds,
      transactionHashes: response.transactionsHashes,
      wallet,
    });
  } catch (error) {
    console.error("Session order submission failed", error instanceof Error ? error.name : "UnknownError");
    return json({
      success: false,
      retryable: false,
      error: error instanceof Error ? error.message : "Order submission failed",
      ambiguous: true,
    }, 502);
  }
});