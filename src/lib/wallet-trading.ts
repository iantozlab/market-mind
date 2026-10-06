// Browser-wallet trading: the order is signed by the user's own wallet
// (MetaMask etc.) and sent to Polymarket from the user's own connection.
// Polymarket trading keys derived from the wallet live in memory only.
import { createPublicClient, createWalletClient, custom, maxUint256, parseAbi, type WalletClient } from 'viem';
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

// ─── Wallet readiness (balance + trading approvals) ─────────────────────────
// Read from the exchange contracts on Polygon: both exchanges settle in the
// collateral token returned by getCollateral() and the CTF from getCtf().
export const COLLATERAL = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB' as const; // pUSD, 6 decimals
export const CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as const;
export const EXCHANGES = [
  { name: 'Standard exchange', address: STANDARD_EXCHANGE as `0x${string}` },
  { name: 'Neg-risk exchange', address: NEG_RISK_EXCHANGE as `0x${string}` },
];
const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const ERC1155 = parseAbi([
  'function isApprovedForAll(address,address) view returns (bool)',
  'function setApprovalForAll(address,bool)',
]);

export interface WalletStatus {
  address: `0x${string}`;
  chainOk: boolean;
  gasPol: number;
  collateral: number;
  approvals: { name: string; spender: string; collateral: boolean; shares: boolean }[];
  tradingKeys: boolean;
  ready: boolean;
  problems: string[];
}

function publicClient() {
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;
  if (!eth) throw new Error('No browser wallet found.');
  return createPublicClient({ chain: polygon, transport: custom(eth) });
}

export async function getWalletStatus(): Promise<WalletStatus> {
  if (!address) throw new Error('Connect your wallet first.');
  const pc = publicClient();
  const chainId = await pc.getChainId();
  const chainOk = chainId === 137;
  const problems: string[] = [];
  if (!chainOk) problems.push('Wallet is not on the Polygon network.');
  const [gas, bal] = await Promise.all([
    pc.getBalance({ address }),
    (pc.readContract as (a: unknown) => Promise<any>)({ address: COLLATERAL, abi: ERC20, functionName: 'balanceOf', args: [address] }),
  ]);
  const approvals = await Promise.all(EXCHANGES.map(async (x) => {
    const [allow, ok1155] = await Promise.all([
      (pc.readContract as (a: unknown) => Promise<any>)({ address: COLLATERAL, abi: ERC20, functionName: 'allowance', args: [address!, x.address] }),
      (pc.readContract as (a: unknown) => Promise<any>)({ address: CTF, abi: ERC1155, functionName: 'isApprovedForAll', args: [address!, x.address] }),
    ]);
    return { name: x.name, spender: x.address, collateral: allow > 10n ** 12n, shares: ok1155 };
  }));
  const gasPol = Number(gas) / 1e18;
  const collateral = Number(bal) / 1e6;
  if (gasPol < 0.05) problems.push('Less than 0.05 POL for network fees (needed to approve).');
  if (collateral <= 0) problems.push('No pUSD trading balance in this wallet.');
  if (approvals.some(a => !a.collateral)) problems.push('Buying is not approved on every exchange.');
  if (approvals.some(a => !a.shares)) problems.push('Selling is not approved on every exchange.');
  return { address, chainOk, gasPol, collateral, approvals, tradingKeys: !!creds, ready: chainOk && collateral > 0 && approvals.every(a => a.collateral), problems };
}

/** Sends the missing approval transactions (each costs a small POL fee). */
export async function approveTrading(onStep?: (s: string) => void): Promise<number> {
  if (!client || !address) await connectWallet();
  const st = await getWalletStatus();
  const pc = publicClient();
  let sent = 0;
  for (const a of st.approvals) {
    if (!a.collateral) {
      onStep?.(`Approve buying on ${a.name}…`);
      const h = await (client!.writeContract as (a: unknown) => Promise<`0x${string}`>)({ account: address!, chain: polygon, address: COLLATERAL, abi: ERC20, functionName: 'approve', args: [a.spender as `0x${string}`, maxUint256] });
      await pc.waitForTransactionReceipt({ hash: h }); sent++;
    }
    if (!a.shares) {
      onStep?.(`Approve selling on ${a.name}…`);
      const h = await (client!.writeContract as (a: unknown) => Promise<`0x${string}`>)({ account: address!, chain: polygon, address: CTF, abi: ERC1155, functionName: 'setApprovalForAll', args: [a.spender as `0x${string}`, true] });
      await pc.waitForTransactionReceipt({ hash: h }); sent++;
    }
  }
  return sent;
}

/** Unlock Polymarket trading keys (one free signature). */
export async function unlockTradingKeys() { await getCreds(); }

// ─── Fills (trades that actually matched) ───────────────────────────────────
export interface Fill { id: string; time: number; side: string; price: number; size: number; outcome: string; market: string; status: string; tx: string | null; role: string }

export async function getFills(): Promise<Fill[]> {
  const c = await getCreds();
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = '/data/trades';
  const r = await fetch(`${CLOB}${path}?maker_address=${address}`, {
    headers: { POLY_ADDRESS: address!, POLY_API_KEY: c.apiKey, POLY_PASSPHRASE: c.passphrase, POLY_TIMESTAMP: ts, POLY_SIGNATURE: await hmac(c.secret, `${ts}GET${path}`) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Polymarket fills request failed (HTTP ${r.status}): ${j.error ?? ''}`);
  const rows = (Array.isArray(j) ? j : j.data ?? []) as Record<string, any>[];
  const me = address!.toLowerCase();
  return rows.map((t) => {
    const mine = t.trader_side === 'MAKER'
      ? (t.maker_orders ?? []).find((m: any) => String(m.maker_address).toLowerCase() === me)
      : null;
    return {
      id: String(t.id), time: Number(t.match_time) * 1000, role: String(t.trader_side ?? ''),
      side: String(mine?.side ?? t.side), price: Number(mine?.price ?? t.price), size: Number(mine?.matched_amount ?? t.size),
      outcome: String(mine?.outcome ?? t.outcome ?? ''), market: String(t.market ?? ''), status: String(t.status ?? ''),
      tx: t.transaction_hash ? String(t.transaction_hash) : null,
    };
  }).sort((a, b) => b.time - a.time);
}

// ─── Bot live-mode safety cap ───────────────────────────────────────────────
const CAP_KEY = 'wallet_max_order_usd';
export const getMaxOrderUsd = () => { const v = Number(localStorage.getItem(CAP_KEY)); return v > 0 ? v : 5; };
export const setMaxOrderUsd = (v: number) => localStorage.setItem(CAP_KEY, String(Math.max(0.1, Math.min(1000, v))));
