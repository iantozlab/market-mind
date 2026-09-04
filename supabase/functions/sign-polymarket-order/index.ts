// supabase/functions/sign-polymarket-order/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { createWalletClient, http } from "npm:viem@2.21.0";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";
import { polygon } from "npm:viem@2.21.0/chains";

// CORS headers for your Lovable frontend
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Handle preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate the request (optional but recommended)
    const authHeader = req.headers.get("Authorization");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );
    
    // Verify the user is authenticated (prevents unauthorized signing)
    const token = authHeader?.replace("Bearer ", "");
    if (token) {
      const { data: { user }, error } = await supabaseClient.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Parse the incoming order data
    const { orderData, domain, types, primaryType } = await req.json();

    // 3. Retrieve the private key from Edge Function secrets (NEVER hardcoded)
    const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY") as `0x${string}`;
    if (!privateKey) {
      throw new Error("Server signing key not configured");
    }

    // 4. Create the signer account
    const account = privateKeyToAccount(privateKey);

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
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
