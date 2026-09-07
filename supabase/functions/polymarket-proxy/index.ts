import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  type Address,
  waitForTransactionReceipt,
} from "npm:viem@2.21.0";
import { privateKeyToAccount } from "npm:viem@2.21.0/accounts";
import { polygon } from "npm:viem@2.21.0/chains";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLOB_BASE = "https://clob.polymarket.com";
const GAMMA_BASE = "https://gamma-api.polymarket.com";
const POLYMARKET_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const;
const POLYMARKET_USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

const ALLOWED_PATHS = [
  "/markets", "/gamma/markets", "/gamma/events", "/book", "/trades",
  "/trades/recent", "/orderbook/summary", "/markets/trending", "/orders", "/__config",
];

const USDC_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

let approvalLock: Promise<void> = Promise.resolve();
let startupChecked = false;

function logJson(level: "info" | "warn" | "error", payload: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function getRpcUrl(): string {
  const rpcUrl = Deno.env.get("POLYGON_RPC_URL");
  if (!rpcUrl) throw new Error("POLYGON_RPC_URL is not configured");
  return rpcUrl;
}

function getPrivateKey(): `0x${string}` {
  const privateKey = Deno.env.get("POLYMARKET_PRIVATE_KEY");
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("POLYMARKET_PRIVATE_KEY is not configured correctly");
  }
  return privateKey as `0x${string}`;
}

function getClients(privateKey: `0x${string}`) {
  const rpcUrl = getRpcUrl();
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain: polygon, transport }),
    walletClient: createWalletClient({ account, chain: polygon, transport }),
  };
}

async function readAllowance(publicClient: ReturnType<typeof createPublicClient>, owner: Address) {
  return await publicClient.readContract({
    address: POLYMARKET_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "allowance",
    args: [owner, POLYMARKET_EXCHANGE_ADDRESS],
  });
}

async function revokeAllowance(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
) {
  const revokeHash = await walletClient.writeContract({
    address: POLYMARKET_USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "approve",
    args: [POLYMARKET_EXCHANGE_ADDRESS, 0n],
  });
  const receipt = await waitForTransactionReceipt(publicClient, { hash: revokeHash });
  if (receipt.status !== "success") throw new Error(`Allowance revocation failed: ${revokeHash}`);
  logJson("info", { event: "allowance_revoked", txHash: revokeHash });
}

async function startupAllowanceCheck(privateKey: `0x${string}`) {
  const { account, publicClient, walletClient } = getClients(privateKey);
  const allowance = await readAllowance(publicClient, account.address);
  const safeThreshold = 10_000_000n;
  if (allowance > safeThreshold) {
    logJson("warn", { event: "lingering_allowance", amount: formatUnits(allowance, 6) });
    await revokeAllowance(walletClient, publicClient);
  } else {
    logJson("info", { event: "startup_allowance_check", amount: formatUnits(allowance, 6) });
  }
}

async function secureAllowanceAndSubmitOrder(signedOrderPayload: Record<string, unknown>) {
  const privateKey = getPrivateKey();
  const { account, publicClient, walletClient } = getClients(privateKey);
  const takerAmount = BigInt(String(signedOrderPayload.takerAmount ?? "0"));
  if (takerAmount <= 0n) throw new Error("Invalid order: takerAmount must be > 0");

  const requiredAllowance = takerAmount + 1_000_000n;
  const currentAllowance = await readAllowance(publicClient, account.address);
  let allowanceWasUsed = currentAllowance > 0n;

  try {
    if (currentAllowance < requiredAllowance) {
      const approveHash = await walletClient.writeContract({
        address: POLYMARKET_USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "approve",
        args: [POLYMARKET_EXCHANGE_ADDRESS, requiredAllowance],
      });
      const receipt = await waitForTransactionReceipt(publicClient, { hash: approveHash });
      if (receipt.status !== "success") throw new Error("Exact allowance approval failed");
      allowanceWasUsed = true;
      logJson("info", { event: "allowance_approved", amount: formatUnits(requiredAllowance, 6), txHash: approveHash });
    }

    const apiKey = Deno.env.get("POLYMARKET_API_KEY");
    const secret = Deno.env.get("POLYMARKET_SECRET");
    const passphrase = Deno.env.get("POLYMARKET_PASSPHRASE");
    if (!apiKey || !secret || !passphrase) throw new Error("Polymarket API credentials are not configured");

    const response = await fetch(`${CLOB_BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "POLYMARKET-API-KEY": apiKey,
        "POLYMARKET-SECRET": secret,
        "POLYMARKET-PASSPHRASE": passphrase,
      },
      body: JSON.stringify(signedOrderPayload),
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`CLOB submission failed: ${response.status} ${responseBody}`);
    return JSON.parse(responseBody) as Record<string, unknown>;
  } finally {
    if (allowanceWasUsed) {
      try {
        await revokeAllowance(walletClient, publicClient);
      } catch (error) {
        logJson("error", { event: "allowance_revoke_failed", error: String(error) });
      }
    }
  }
}

async function proxyRequest(endpoint: string, params: string | undefined, method: string, requestBody: unknown) {
  const isGamma = endpoint.startsWith("/gamma/");
  const upstreamPath = isGamma ? endpoint.replace("/gamma", "") : endpoint;
  const base = isGamma ? GAMMA_BASE : CLOB_BASE;
  const targetUrl = `${base}${upstreamPath}${params ? `?${params}` : ""}`;
  const apiKey = Deno.env.get("POLYMARKET_API_KEY");
  const secret = Deno.env.get("POLYMARKET_SECRET");
  const passphrase = Deno.env.get("POLYMARKET_PASSPHRASE");
  if (!apiKey || !secret || !passphrase) throw new Error("Polymarket API credentials are not configured");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "POLYMARKET-API-KEY": apiKey,
    "POLYMARKET-SECRET": secret,
    "POLYMARKET-PASSPHRASE": passphrase,
  };
  const response = await fetch(targetUrl, {
    method: method === "HEAD" ? "HEAD" : method === "POST" ? "POST" : "GET",
    headers,
    body: method === "POST" && requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let endpoint = "";
  try {
    const input = await req.json() as { endpoint?: string; params?: string; method?: string; body?: unknown };
    endpoint = input.endpoint ?? "";
    if (!endpoint) return new Response(JSON.stringify({ error: "Missing endpoint parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (endpoint === "/__config") {
      return new Response(JSON.stringify({
        polygonRpcUrl: !!Deno.env.get("POLYGON_RPC_URL"),
        blocknativeApiKey: !!Deno.env.get("BLOCKNATIVE_API_KEY"),
        polymarketApiKey: !!Deno.env.get("POLYMARKET_API_KEY"),
        polymarketPrivateKey: !!Deno.env.get("POLYMARKET_PRIVATE_KEY"),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!ALLOWED_PATHS.some((path) => endpoint.startsWith(path))) {
      return new Response(JSON.stringify({ error: "Endpoint not allowed" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const method = input.method ?? "GET";

    if (!startupChecked) {
      try {
        await startupAllowanceCheck(getPrivateKey());
        startupChecked = true;
      } catch (error) {
        logJson("error", { event: "startup_allowance_check_failed", error: String(error) });
      }
    }

    if (endpoint === "/orders" && method === "POST") {
      await approvalLock;
      let release!: () => void;
      approvalLock = new Promise<void>((resolve) => { release = resolve; });
      try {
        if (!input.body || typeof input.body !== "object") throw new Error("Missing signed order payload");
        const result = await secureAllowanceAndSubmitOrder(input.body as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, status: 200, body: JSON.stringify(result) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } finally {
        release();
      }
    }

    const result = await proxyRequest(endpoint, input.params, method, input.body);
    if (method === "HEAD") {
      return new Response(JSON.stringify({ ok: result.ok, status: result.status, body: "" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    logJson("error", { event: "proxy_exception", endpoint, error: String(error) });
    return new Response(JSON.stringify({ error: "Proxy request failed", detail: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
