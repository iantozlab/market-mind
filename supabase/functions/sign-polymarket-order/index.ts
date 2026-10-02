// supabase/functions/sign-polymarket-order/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";
import { hashTypedData } from "npm:viem@2.21.0";

// CORS headers for your Lovable frontend
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const expectedDomain = {
  name: "Polymarket CTF Exchange",
  version: "2",
  chainId: 137,
};
const allowedExchanges = new Set([
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
]);
const expectedOrderTypes = {
  Order: [
    { name: "salt", type: "uint256" }, { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" }, { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" }, { name: "timestamp", type: "uint256" },
    { name: "metadata", type: "bytes32" }, { name: "builder", type: "bytes32" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // Handle preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "signer") {
      const allowedOrigins = (Deno.env.get("POLYMARKET_ALLOWED_ORIGIN") ?? "")
        .split(",").map((o) => o.trim()).filter(Boolean);
      const requestOrigin = req.headers.get("Origin");
      if (allowedOrigins.length > 0 && (!requestOrigin || !allowedOrigins.includes(requestOrigin))) {
        return jsonResponse({ error: "Origin not allowed" }, 403);
      }

      const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
      try {
        const client = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        );
        const { data: { user }, error } = await client.auth.getUser(token);
        if (error || !user) return jsonResponse({ error: "Unauthorized" }, 401);
        const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY");
        if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
          return jsonResponse({ error: "Signing service unavailable" }, 503);
        }
        return jsonResponse({ signerAddress: privateKeyToAccount(privateKey as `0x${string}`).address });
      } catch {
        return jsonResponse({ error: "Signer address lookup failed" }, 500);
      }
    }

    return jsonResponse({
      status: "ok",
      service: "sign-polymarket-order",
      deployed: true,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const requestOrigin = req.headers.get("Origin");
    const allowedOrigins = (Deno.env.get("POLYMARKET_ALLOWED_ORIGIN") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (allowedOrigins.length > 0 && (!requestOrigin || !allowedOrigins.includes(requestOrigin))) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Authenticate every signing request.
    const authHeader = req.headers.get("Authorization");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    
    // Verify the user is authenticated (prevents unauthorized signing)
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    {
      const { data: { user }, error } = await supabaseClient.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }      const admin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (isAdmin !== true) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    // 2. Parse the incoming order data
    const { orderData, domain, types, primaryType, requestId, timestamp, origin } = await req.json();
    if (!orderData || !domain || !types || primaryType !== "Order" ||
      domain.name !== expectedDomain.name || domain.version !== expectedDomain.version ||
      domain.chainId !== expectedDomain.chainId || !allowedExchanges.has(domain.verifyingContract) ||
      JSON.stringify(types) !== JSON.stringify(expectedOrderTypes) ||
      typeof requestId !== "string" ||
      !/^0x[0-9a-f]{64}-[0-9a-f-]{36}$/i.test(requestId) ||
        typeof timestamp !== "number" || Math.abs(Date.now() - timestamp) > 60_000 ||
        typeof origin !== "string" || origin !== requestOrigin) {
      return new Response(JSON.stringify({ error: "Invalid signing request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validationErrors: string[] = [];
    try {
      if (!orderData.salt || BigInt(orderData.salt) === 0n) validationErrors.push("salt must be a non-zero uint256");
      if (!orderData.makerAmount || BigInt(orderData.makerAmount) <= 0n) validationErrors.push("makerAmount must be > 0");
      if (!orderData.takerAmount || BigInt(orderData.takerAmount) <= 0n) validationErrors.push("takerAmount must be > 0");
      if (!orderData.timestamp || Math.abs(Date.now() - Number(orderData.timestamp)) > 60_000) validationErrors.push("timestamp must be current Unix milliseconds");
      if (orderData.signatureType !== 0) validationErrors.push("only EOA signature type is configured");
    } catch {
      validationErrors.push("numeric order fields are invalid");
    }
    if (validationErrors.length > 0) {
      return jsonResponse({ success: false, error: "Invalid order", details: validationErrors }, 400);
    }

    // 3. Retrieve the private key from Edge Function secrets (NEVER hardcoded)
    const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY") as `0x${string}`;
    if (!privateKey) {
      throw new Error("Server signing key not configured");
    }

    // 4. Create the signer account
    const account = privateKeyToAccount(privateKey);
    if (typeof orderData.signer !== "string" || typeof orderData.maker !== "string" ||
      orderData.signer.toLowerCase() !== account.address.toLowerCase() ||
      orderData.maker.toLowerCase() !== account.address.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Order signer mismatch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Sign the order using EIP-712
    const signature = await account.signTypedData({
      domain,
      types,
      primaryType: primaryType || "Order",
      message: orderData,
    });

    const orderHash = hashTypedData({
      domain,
      types,
      primaryType,
      message: orderData,
    });

    // 6. Return the signature to the frontend
    return new Response(
      JSON.stringify({
        success: true,
        signature: signature,
        signerAddress: account.address,
        orderHash,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Signing request failed", error instanceof Error ? error.name : "UnknownError");
    return new Response(
      JSON.stringify({ success: false, error: "Signing request failed" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
