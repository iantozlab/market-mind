// Browser-wallet trading: the order is signed by the user's own wallet
// (MetaMask etc.) and sent to Polymarket from the user's own connection.
// Polymarket trading keys derived from the wallet live in memory only.
import { createWalletClient, custom, type WalletClient } from 'viem';
import { polygon } from 'viem/chains';
import { supabase } from '@/integrations/supabase/client';
import type { OrderAuditRow } from '@/lib/order-audit';

const CLOB = 'https://clob.polymarket.com';
const STANDARD_EXCHANGE = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_EXCHANGE = '0xe2222d279d744050d28e00520010520000310F59';
const ZERO32 = `0x${'0'.repeat(64)}` as const;

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' }, { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' }, { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' }, { name: 'takerAmount', type: 'uint256' },
    { name: 'side', type: 'uint8' }, { name: 'signatureType', type: 'uint8' },
    { name: 'timestamp', type: 'uint256' }, { name: 'metadata', type: 'bytes32' },
    { name: 'builder', type: 'bytes32' },
  ],
} as const;
const AUTH_TYPES = {
  ClobAuth: [
    { name: 'address', type: 'address' }, { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' }, { name: 'message', type: 'string' },
  ],
} as const;

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
interface Creds { apiKey: string; secret: string; passphrase: string }

let client: WalletClient | null = null;
let address: `0x${string}` | null = null;
let creds: Creds | null = null;

export const hasWallet = () => typeof window !== 'undefined' && !!(window as unknown as { ethereum?: Eth }).ethereum;
export const walletAddress = () => address;

export async function connectWallet(): Promise<`0x${string}`> {
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;
  if (!eth) throw new Error('No browser wallet found. Install MetaMask (or similar) and reload.');
  const [acct] = (await eth.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
  if (!acct) throw new Error('Wallet did not share an account.');
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] });
  } catch {
    await eth.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'],
    }] });
  }
  if (address?.toLowerCase() !== acct.toLowerCase()) creds = null;
  address = acct;
  client = createWalletClient({ account: acct, chain: polygon, transport: custom(eth) });
  return acct;
}

function b64ToBytes(s: string) {
  const n = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(n.padEnd(Math.ceil(n.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_');
}

/** One wallet signature (no gas) unlocks Polymarket trading keys for this wallet. */
async function getCreds(): Promise<Creds> {
  if (creds) return creds;
  if (!client || !address) throw new Error('Connect your wallet first.');
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await client.signTypedData({
    account: address, domain: { name: 'ClobAuthDomain', version: '1', chainId: 137 },
    types: AUTH_TYPES, primaryType: 'ClobAuth',
    message: { address, timestamp: ts, nonce: 0n, message: 'This message attests that I control the given wallet' },
  });
  const headers = { POLY_ADDRESS: address, POLY_SIGNATURE: signature, POLY_TIMESTAMP: ts, POLY_NONCE: '0' };
  let r = await fetch(`${CLOB}/auth/derive-api-key`, { headers });
  if (!r.ok) r = await fetch(`${CLOB}/auth/api-key`, { method: 'POST', headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.apiKey) throw new Error(`Polymarket did not issue trading keys (HTTP ${r.status}): ${j.error ?? JSON.stringify(j)}`);
  creds = { apiKey: j.apiKey, secret: j.secret, passphrase: j.passphrase };
  return creds;
}

export interface WalletOrder {
  tokenId: string; side: 'BUY' | 'SELL'; price: number; size: number;
  orderType: 'GTC' | 'FAK' | 'FOK'; marketLabel?: string; retryOf?: string;
}

async function record(o: WalletOrder, r: { status: string; httpStatus: number | null; response: unknown; errorMessage: string | null; orderId: string | null }) {
  const { data, error } = await supabase.functions.invoke('record-wallet-order', { body: { ...o, ...r, wallet: address } });
  if (error) throw new Error(`Order was sent, but saving it failed: ${error.message}`);
  return data.order as OrderAuditRow;
}

/** Sign in the wallet and send from this browser. Returns the saved record. */
export async function placeWalletOrder(o: WalletOrder): Promise<OrderAuditRow> {
  if (!client || !address) await connectWallet();
  const c = await getCreds();

  const br = await fetch(`${CLOB}/book?token_id=${o.tokenId}`);
  const book = await br.json().catch(() => ({}));
  if (!br.ok) return record(o, { status: 'rejected', httpStatus: br.status, response: book, errorMessage: book?.error ?? 'Order book lookup failed', orderId: null });
  const tick = Number(book.tick_size) || 0.01;
  const minSize = Number(book.min_order_size) || 0;
  const price = +(Math.round(o.price / tick) * tick).toFixed(6);
  if (Math.abs(price - o.price) > 1e-9) throw new Error(`Price must be a multiple of ${tick}.`);
  if (o.size < minSize) throw new Error(`Size must be at least ${minSize} shares on this market.`);

  const shares = Math.round(o.size * 100) / 100;
  const usdc = Math.round(shares * price * 10000) / 10000;
  const sharesU = BigInt(Math.round(shares * 1e6));
  const usdcU = BigInt(Math.round(usdc * 1e6));
  const isBuy = o.side === 'BUY';
  const now = Date.now();
  const salt = Math.floor(Math.random() * 2 ** 48) + 1;
  const message = {
    salt: BigInt(salt), maker: address!, signer: address!, tokenId: BigInt(o.tokenId),
    makerAmount: isBuy ? usdcU : sharesU, takerAmount: isBuy ? sharesU : usdcU,
    side: isBuy ? 0 : 1, signatureType: 0, timestamp: BigInt(now), metadata: ZERO32, builder: ZERO32,
  };
  const signature = await client!.signTypedData({
    account: address!,
    domain: { name: 'Polymarket CTF Exchange', version: '2', chainId: 137,
      verifyingContract: (book.neg_risk === true ? NEG_RISK_EXCHANGE : STANDARD_EXCHANGE) as `0x${string}` },
    types: ORDER_TYPES, primaryType: 'Order', message,
  });
  const order = {
    builder: ZERO32, expiration: '0', maker: address, makerAmount: message.makerAmount.toString(),
    metadata: ZERO32, salt, side: o.side, signature, signatureType: 0, signer: address,
    takerAmount: message.takerAmount.toString(), timestamp: String(now), tokenId: o.tokenId,
  };
  const body = JSON.stringify({ deferExec: false, order, orderType: o.orderType, owner: c.apiKey });
  const ts = Math.floor(now / 1000).toString();

  let httpStatus = 0, raw = '', parsed: unknown = null;
  try {
    const r = await fetch(`${CLOB}/order`, {
      method: 'POST', body,
      headers: {
        'Content-Type': 'application/json', POLY_ADDRESS: address!, POLY_API_KEY: c.apiKey,
        POLY_PASSPHRASE: c.passphrase, POLY_TIMESTAMP: ts, POLY_SIGNATURE: await hmac(c.secret, `${ts}POST/order${body}`),
      },
    });
    httpStatus = r.status; raw = await r.text();
    try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
  } catch (e) {
    return record(o, { status: 'error', httpStatus: null, response: null, errorMessage: `Network error reaching Polymarket: ${String(e)}`, orderId: null });
  }
  const p = (parsed ?? {}) as Record<string, unknown>;
  const ok = httpStatus >= 200 && httpStatus < 300 && p.success !== false && !p.error;
  return record(o, {
    status: ok ? String(p.status ?? 'accepted') : 'rejected', httpStatus, response: parsed,
    errorMessage: ok ? null : String(p.errorMsg ?? p.error ?? raw).slice(0, 2000),
    orderId: typeof p.orderID === 'string' ? p.orderID : null,
  });
}
