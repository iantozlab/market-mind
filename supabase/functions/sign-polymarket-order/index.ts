// supabase/functions/sign-polymarket-order/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";

// CORS headers for your Lovable frontend
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const expectedDomain = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: 137,
  verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
};
const expectedOrderTypes = {
  Order: [
    { name: "salt", type: "uint256" }, { name: "maker", type: "address" },
    { name: "signer", type: "address" }, { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" }, { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" }, { name: "signatureType", type: "uint8" },
    { name: "useTaker", type: "bool" },
  ],
};

serve(async (req) => {
  // Handle preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const requestOrigin = req.headers.get("Origin");
    const allowedOrigin = Deno.env.get("POLYMARKET_ALLOWED_ORIGIN");
    if (allowedOrigin && requestOrigin !== allowedOrigin) {
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
      }
    }

    // 2. Parse the incoming order data
    const { orderData, domain, types, primaryType, requestId, timestamp, origin } = await req.json();
    if (!orderData || !domain || !types || primaryType !== "Order" ||
      JSON.stringify(domain) !== JSON.stringify(expectedDomain) ||
      JSON.stringify(types) !== JSON.stringify(expectedOrderTypes) ||
      !/^0x[0-9a-f]{64}-[0-9a-f-]{36}$/i.test(requestId) ||
      typeof requestId !== "string" ||
        typeof timestamp !== "number" || Math.abs(Date.now() - timestamp) > 60_000 ||
        typeof origin !== "string" || origin !== requestOrigin) {
      return new Response(JSON.stringify({ error: "Invalid signing request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Retrieve the private key from Edge Function secrets (NEVER hardcoded)
    const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY") as `0x${string}`;
    if (!privateKey) {
      throw new Error("Server signing key not configured");
    }

    // 4. Create the signer account
    const account = privateKeyToAccount(privateKey);
    if (typeof orderData.signer !== "string" ||
        orderData.signer.toLowerCase() !== account.address.toLowerCase()) {
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

    // 6. Return the signature to the frontend
    return new Response(
      JSON.stringify({
        success: true,
        signature: signature,
        signerAddress: account.address,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Signing error:", error);
    const message = error instanceof Error ? error.message : "Signing failed";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
