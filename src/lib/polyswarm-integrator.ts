// PolySwarmIntegrator.ts
// 50-agent swarm with confidence-weighted Bayesian aggregation and
// KL / JS divergence based cross-market inefficiency detection.
// Browser-safe: minimal internal emitter (no node `events`).

import { hashTypedData, verifyTypedData, type Address } from 'viem';
import { supabase } from '@/integrations/supabase/client';

export const POLYMARKET_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as const;
export const POLYMARKET_DOMAIN = {
  name: 'Polymarket CTF Exchange', version: '1', chainId: 137,
  verifyingContract: POLYMARKET_EXCHANGE_ADDRESS,
} as const;
export const POLYMARKET_ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' }, { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' }, { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' }, { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' }, { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' }, { name: 'signatureType', type: 'uint8' },
    { name: 'useTaker', type: 'bool' },
  ],
} as const;

const SIGNING_FUNCTION_URL = 'https://buvepdnnsurgfthtgtyz.supabase.co/functions/v1/sign-polymarket-order';
const pendingRequests = new Map<string, Promise<`0x${string}`>>();
let cachedSignerAddress: Address | null = null;
type OrderData = Record<string, unknown>;
type SignatureResult = { signature: `0x${string}`; signerAddress: Address };

function isNonZeroInteger(value: unknown): boolean {
  try {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
      ? BigInt(value) > 0n : false;
  } catch { return false; }
}

async function signOrderViaBackend(
  orderData: OrderData, domain: typeof POLYMARKET_DOMAIN,
  types: typeof POLYMARKET_ORDER_TYPES, primaryType: 'Order', requestId: string,
): Promise<SignatureResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Unauthenticated: sign in before signing orders.');

  const response = await fetch(SIGNING_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ orderData, domain, types, primaryType, requestId,
      timestamp: Date.now(), origin: window.location.origin }),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Session expired. Please re-authenticate.');
    throw new Error('Order signing failed. Please try again later.');
  }

  const result = await response.json() as Partial<SignatureResult> & { success?: boolean };
  if (!result.success || typeof result.signature !== 'string' || typeof result.signerAddress !== 'string') {
    throw new Error('Invalid response from signing service.');
  }
  const signature = result.signature as `0x${string}`;
  const signerAddress = result.signerAddress as Address;
  if (!await verifyTypedData({ address: signerAddress, domain, types, primaryType,
    message: orderData as never, signature })) throw new Error('Signature verification failed.');
  if (cachedSignerAddress && cachedSignerAddress.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error('Signer address changed unexpectedly.');
  }
  cachedSignerAddress = signerAddress;
  return { signature, signerAddress };
}

export async function signOrder(
  orderData: OrderData, domain = POLYMARKET_DOMAIN,
  types = POLYMARKET_ORDER_TYPES, primaryType: 'Order' = 'Order',
): Promise<`0x${string}`> {
  if (!isNonZeroInteger(orderData.salt)) throw new Error('Invalid order: salt is required.');
  if (!isNonZeroInteger(orderData.makerAmount)) throw new Error('Invalid order: makerAmount must be positive.');
  if (!isNonZeroInteger(orderData.takerAmount)) throw new Error('Invalid order: takerAmount must be positive.');
  const expiration = Number(orderData.expiration);
  if (!Number.isSafeInteger(expiration) || expiration <= Math.floor(Date.now() / 1000)) {
    throw new Error('Invalid order: expiration must be in the future.');
  }

  const orderHash = hashTypedData({ domain, types, primaryType, message: orderData as never });
  const pending = pendingRequests.get(orderHash);
  if (pending) return pending;
  const signingPromise = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return (await signOrderViaBackend(orderData, domain, types, primaryType,
          `${orderHash}-${crypto.randomUUID()}`)).signature;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to sign order.');
  })();
  pendingRequests.set(orderHash, signingPromise);
  signingPromise.finally(() => {
    if (pendingRequests.get(orderHash) === signingPromise) pendingRequests.delete(orderHash);
  }).catch(() => undefined);
  return signingPromise;
}

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
