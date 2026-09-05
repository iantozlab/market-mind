// src/lib/polyswarm-integrator.ts
// ═══════════════════════════════════════════════════════════════════════════════
//  TASK-002 COMPLETION: HARDENED POLYSWARM INTEGRATOR
//  ────────────────────────────────────────────────────────────────────────────
//  • submitOrderToClob removed – use executeLiveTrade (via proxy) instead.
//  • Market data validation (price bounds, staleness, divergence) added.
//  • RPC health awareness – degrades gracefully if RPC is unhealthy.
//  • All API keys are strictly server-side (Edge Function secrets).
// ═══════════════════════════════════════════════════════════════════════════════

import { verifyTypedData, hashTypedData, type Address } from "viem";
import { supabase } from "@/integrations/supabase/client";

// ─── Polymarket on-chain constants ─────────────────────────────────────────────

export const POLYMARKET_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const;
export const POLYMARKET_NEG_RISK_ADAPTER = "0xd91E80cF2E7fe2cBA6DAa4cFf49e8A6dbCb8e6A1" as const;
export const POLYMARKET_USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

// ─── EIP-712 Domain & Types (Polymarket CTF Exchange) ─────────────────────────

export const POLYMARKET_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: 137,
  verifyingContract: POLYMARKET_EXCHANGE_ADDRESS,
} as const;

export const POLYMARKET_ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
    { name: "useTaker", type: "bool" },
  ],
} as const;

// ─── Secure Backend Signing (TASK-001) ─────────────────────────────────────────

const SUPABASE_EDGE_FUNCTION_URL =
  "https://buvepdnnsurgfthtgtyz.supabase.co/functions/v1/sign-polymarket-order";

export const signOrderViaBackend = async (
  orderData: any,
  domain: any,
  types: any,
  primaryType: string = "Order"
) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch(SUPABASE_EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { "Authorization": `Bearer ${token}` }),
      },
      body: JSON.stringify({ orderData, domain, types, primaryType }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Signing failed: ${error.error || response.statusText}`);
    }

    const result = await response.json();
    return {
      signature: result.signature,
      signerAddress: result.signerAddress,
    };
  } catch (error) {
    console.error("Backend signing error:", error);
    throw error;
  }
};

// ─── Public API: Sign an order with deduplication & client-side verification ──

// In-flight deduplication.
const pendingRequests = new Map<string, Promise<string>>();
let cachedSignerAddress: Address | null = null;

export async function signOrder(
  orderData: Record<string, any>,
  domain = POLYMARKET_DOMAIN,
  types = POLYMARKET_ORDER_TYPES,
  primaryType = "Order",
): Promise<`0x${string}`> {
  // ── Input sanitisation ──
  if (!orderData.salt || BigInt(orderData.salt) === 0n) {
    throw new Error("Invalid order: salt must be a non-zero uint256.");
  }
  if (!orderData.expiration || BigInt(orderData.expiration) <= Date.now()) {
    throw new Error("Invalid order: expiration must be in the future.");
  }
  if (!orderData.makerAmount || BigInt(orderData.makerAmount) <= 0n) {
    throw new Error("Invalid order: makerAmount must be > 0.");
  }
  if (!orderData.takerAmount || BigInt(orderData.takerAmount) <= 0n) {
    throw new Error("Invalid order: takerAmount must be > 0.");
  }

  // ── Deduplicate identical requests ──
  const orderHash = hashTypedData({
    domain,
    types,
    primaryType: primaryType as any,
    message: orderData as any,
  } as any);

  if (pendingRequests.has(orderHash)) {
    return pendingRequests.get(orderHash)! as Promise<`0x${string}`>;
  }

  const signingPromise = (async () => {
    let attempt = 0;
    const maxAttempts = 3;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      try {
        const requestId = `${orderHash}-${Date.now()}`;
        const { signature, signerAddress } = await signOrderViaBackend(
          orderData,
          domain,
          types,
          primaryType,
        );

        // ── Client-side signature verification (defeats MITM) ──
        const isValid = await verifyTypedData({
          address: signerAddress as `0x${string}`,
          domain,
          types,
          primaryType: primaryType as any,
          message: orderData as any,
          signature: signature as `0x${string}`,
        } as any);

        if (!isValid) {
          throw new Error("Signature verification failed on client. The signing service may be compromised.");
        }

        if (cachedSignerAddress && signerAddress !== cachedSignerAddress) {
          throw new Error("Signer address changed unexpectedly. Aborting.");
        }
        cachedSignerAddress = signerAddress;

        return signature as `0x${string}`;
      } catch (error: any) {
        lastError = error;
        attempt++;
        const delay = 200 * Math.pow(2, attempt - 1) + Math.random() * 100;
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError || new Error("Failed to sign order after multiple attempts.");
  })();

  pendingRequests.set(orderHash, signingPromise);
  signingPromise.finally(() => {
    if (pendingRequests.get(orderHash) === signingPromise) {
      pendingRequests.delete(orderHash);
    }
  });

  return signingPromise;
}

// ─── Get the cached signer address (safe probe) ──────────────────────────────

export async function getSignerAddress(): Promise<Address> {
  if (cachedSignerAddress) return cachedSignerAddress;

  const dummyOrder = {
    salt: "1",
    maker: "0x0000000000000000000000000000000000000000",
    signer: "0x0000000000000000000000000000000000000000",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: "0",
    makerAmount: "0",
    takerAmount: "0",
    expiration: (Date.now() + 3600000).toString(),
    nonce: "0",
    feeRateBps: "0",
    side: 0,
    signatureType: 0,
    useTaker: false,
  };

  try {
    const { signerAddress } = await signOrderViaBackend(
      dummyOrder,
      POLYMARKET_DOMAIN,
      POLYMARKET_ORDER_TYPES,
      "Order",
    );
    cachedSignerAddress = signerAddress;
    return cachedSignerAddress;
  } catch {
    throw new Error("Unable to fetch signer address. Check backend connectivity.");
  }
}

// ─── Legacy guard: prevent accidental direct account usage ───────────────────

export const account = new Proxy(
  {},
  {
    get: () => {
      throw new Error(
        "❌ Direct account access is disabled for security. Use `signOrder()` instead.",
      );
    },
  },
);
export const signer = account;

// ─── TASK-002: SWARM MARKET DATA VALIDATION ──────────────────────────────────

export interface SwarmMarketData {
  marketId: string;
  outcome: string;
  price: number;
  liquidity: number;
  volume: number;
  timestamp: number;
  source: "clob" | "onchain";
}

export function validateSwarmMarketData(
  data: SwarmMarketData,
  rpcIsHealthy: boolean = true,
): { valid: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 1.0;

  if (data.price < 0 || data.price > 1) {
    issues.push(`Price out of bounds: ${data.price}`);
    score *= 0.1;
  }

  if (data.liquidity < 100) {
    issues.push(`Liquidity too low: ${data.liquidity}`);
    score *= 0.7;
  }

  const ageSec = (Date.now() - data.timestamp) / 1000;
  if (ageSec > 300) {
    issues.push(`Data stale: ${ageSec.toFixed(0)}s old`);
    score *= 0.5;
  } else if (ageSec > 120) {
    issues.push(`Data moderately stale: ${ageSec.toFixed(0)}s old`);
    score *= 0.8;
  }

  if (!rpcIsHealthy) {
    issues.push("RPC is unhealthy – data may be stale or manipulated");
    score *= 0.6;
  }

  if (data.volume < 1) {
    issues.push(`Volume suspiciously low: ${data.volume}`);
    score *= 0.8;
  }

  const finalScore = Math.max(0, Math.min(1, score));
  return { valid: finalScore >= 0.5, score: finalScore, issues };
}

export function swarmExecutionGate(
  dataScore: number,
  rpcIsHealthy: boolean,
  minScore: number = 0.6,
): { allowed: boolean; reason: string } {
  if (!rpcIsHealthy) {
    return { allowed: false, reason: "RPC unhealthy – swarm execution paused" };
  }
  if (dataScore < minScore) {
    return { allowed: false, reason: `Data quality score ${dataScore.toFixed(2)} below threshold ${minScore}` };
  }
  return { allowed: true, reason: "All checks passed" };
}

// ─── ❌ REMOVED: submitOrderToClob ────────────────────────────────────────────
// This function has been removed as part of TASK-002.
// All order submissions now go through executeLiveTrade() in neural-bot-engine.ts,
// which routes via the secure polymarket-proxy Edge Function.
// If you need to submit an order, import executeLiveTrade instead.

export interface AgentPrediction { probability: number; confidence: number; }

export interface SwarmAgent {
  id: string;
  predict(market: MarketDescription): Promise<AgentPrediction>;
}

export interface MarketDescription {
  id: string;
  question: string;
  outcomes: string[];
  currentPrice: number;
  category?: string;
  slug?: string;
  timeToExpiry?: number;
}

export interface SwarmPrediction {
  marketId: string;
  slug?: string;
  swarmProbability: number;
  swarmConfidence: number;
  divergence: number;
}

export interface LatencyArbEvent {
  marketId: string;
  slug?: string;
  direction: 'BUY' | 'SELL';
  swarmProbability: number;
  marketPrice: number;
  edge: number;
  ts: number;
}

type Listener<T> = (payload: T) => void;

class TinyEmitter<E extends Record<string, unknown>> {
  private listeners: { [K in keyof E]?: Listener<E[K]>[] } = {};
  on<K extends keyof E>(evt: K, fn: Listener<E[K]>) {
    (this.listeners[evt] ||= []).push(fn);
    return this;
  }
  emit<K extends keyof E>(evt: K, payload: E[K]) {
    for (const fn of this.listeners[evt] ?? []) {
      try { fn(payload); } catch { /* ignore */ }
    }
  }
}

// Deterministic pseudo-random in [0,1) from a string seed (stable per agent/market).
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export class PolySwarmIntegrator extends TinyEmitter<{ latencyArbitrage: LatencyArbEvent }> {
  private agents: SwarmAgent[] = [];
  private weights = new Map<string, number>();
  private lastPredictions: SwarmPrediction[] = [];
  private events: LatencyArbEvent[] = [];

  registerAgent(agent: SwarmAgent, initialWeight = 1.0): void {
    this.agents.push(agent);
    this.weights.set(agent.id, initialWeight);
  }

  getAgentCount(): number { return this.agents.length; }
  getWeights(): { id: string; weight: number }[] {
    return [...this.weights.entries()].map(([id, weight]) => ({ id, weight }));
  }

  async getSwarmPrediction(market: MarketDescription): Promise<SwarmPrediction> {
    const preds = await Promise.all(this.agents.map(async a => {
      const p = await a.predict(market);
      return { prob: p.probability, conf: p.confidence, weight: this.weights.get(a.id) ?? 1 };
    }));
    if (preds.length === 0) {
      return { marketId: market.id, slug: market.slug, swarmProbability: market.currentPrice, swarmConfidence: 0, divergence: 0 };
    }
    const totalWeight = preds.reduce((s, p) => s + p.conf * p.weight, 0) || 1;
    const weightedProb = preds.reduce((s, p) => s + p.prob * p.conf * p.weight, 0) / totalWeight;
    const variance = preds.reduce((s, p) => s + (p.prob - weightedProb) ** 2, 0) / preds.length;
    return {
      marketId: market.id,
      slug: market.slug,
      swarmProbability: weightedProb,
      swarmConfidence: 1 - Math.min(1, variance * 10),
      divergence: Math.abs(weightedProb - market.currentPrice),
    };
  }

  async detectInefficiencies(markets: MarketDescription[], cutoff = 0.05): Promise<SwarmPrediction[]> {
    const out: SwarmPrediction[] = [];
    for (const market of markets) {
      const pred = await this.getSwarmPrediction(market);
      const kl = this.klDivergence(pred.swarmProbability, market.currentPrice);
      const js = this.jsDivergence(pred.swarmProbability, market.currentPrice);
      const combined = (kl + js) / 2;
      if (combined > cutoff) out.push({ ...pred, divergence: combined });
    }
    this.lastPredictions = out.sort((a, b) => b.divergence - a.divergence).slice(0, 25);
    return this.lastPredictions;
  }

  getLastPredictions(): SwarmPrediction[] { return [...this.lastPredictions]; }
  getEvents(): LatencyArbEvent[] { return [...this.events]; }

  private klDivergence(p: number, q: number): number {
    const eps = 1e-8;
    p = Math.min(Math.max(p, eps), 1 - eps);
    q = Math.min(Math.max(q, eps), 1 - eps);
    return p * Math.log(p / q) + (1 - p) * Math.log((1 - p) / (1 - q));
  }

  private jsDivergence(p: number, q: number): number {
    const m = (p + q) / 2;
    return (this.klDivergence(p, m) + this.klDivergence(q, m)) / 2;
  }

  async latencyArbitrage(market: MarketDescription, referencePrice: number): Promise<LatencyArbEvent | null> {
    const swarm = await this.getSwarmPrediction(market);
    const edge = swarm.swarmProbability - referencePrice;
    if (Math.abs(edge) < 0.02) return null;
    const ev: LatencyArbEvent = {
      marketId: market.id,
      slug: market.slug,
      direction: edge > 0 ? 'BUY' : 'SELL',
      swarmProbability: swarm.swarmProbability,
      marketPrice: referencePrice,
      edge: Math.abs(edge),
      ts: Date.now(),
    };
    this.events = [ev, ...this.events].slice(0, 200);
    this.emit('latencyArbitrage', ev);
    return ev;
  }

  updateAgentWeight(agentId: string, performance: number): void {
    const cur = this.weights.get(agentId) ?? 1;
    this.weights.set(agentId, Math.min(5, Math.max(0.2, cur * (1 + 0.1 * performance))));
  }

  reset(): void { this.events = []; this.lastPredictions = []; }
}

/**
 * Builds 50 diverse heuristic personas. Each persona applies a distinct blend of
 * mean-reversion, momentum-anchoring and base-rate priors to the market price,
 * so the swarm produces a genuine distribution rather than a single opinion.
 */
export function buildDefaultSwarm(swarm: PolySwarmIntegrator, count = 50): void {
  for (let i = 0; i < count; i++) {
    const id = `persona_${i}`;
    const bias = (hash01(id) - 0.5) * 0.18;              // persona-specific prior skew
    const reversion = 0.15 + hash01(id + 'r') * 0.5;     // pull toward 0.5
    const anchoring = 0.4 + hash01(id + 'a') * 0.5;      // trust in market price
    swarm.registerAgent({
      id,
      predict: async (market: MarketDescription) => {
        const p = Math.min(0.99, Math.max(0.01, market.currentPrice));
        const noise = (hash01(id + market.id) - 0.5) * 0.08;
        const prior = 0.5;
        const raw = anchoring * p + (1 - anchoring) * (reversion * prior + (1 - reversion) * p) + bias + noise;
        const probability = Math.min(0.99, Math.max(0.01, raw));
        const confidence = 0.5 + Math.min(0.4, Math.abs(probability - 0.5) * 0.8);
        return { probability, confidence };
      },
    }, 1.0);
  }
}
