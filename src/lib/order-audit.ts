import { supabase } from '@/integrations/supabase/client';

export interface OrderAuditRow {
  id: string;
  created_at: string;
  mode: string;
  market_label: string | null;
  token_id: string | null;
  side: string;
  price: number;
  size: number;
  order_type: string;
  status: string;
  http_status: number | null;
  polymarket_response: unknown;
  error_message: string | null;
  order_id: string | null;
  retry_of: string | null;
}

export async function fetchOrders(opts: { mode?: 'live' | 'paper'; limit?: number } = {}) {
  let q = supabase.from('order_audit_log').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.mode) q = q.eq('mode', opts.mode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrderAuditRow[];
}

/** Record a simulated (paper) trade. Never blocks the bot. */
export function logPaperOrder(o: { marketLabel: string; side: string; price: number; size: number }) {
  void supabase.from('order_audit_log').insert({
    mode: 'paper', market_label: o.marketLabel.slice(0, 300), side: o.side,
    price: o.price, size: o.size, order_type: 'SIM', status: 'simulated',
    polymarket_response: { note: 'Paper trade — not sent to Polymarket' },
  }).then(() => undefined, () => undefined);
}

/** Place (or retry) a real order through the secure server step. */
export async function placeLiveOrder(o: {
  tokenId: string; side: string; price: number; size: number; orderType: string; marketLabel?: string; retryOf?: string;
}) {
  const { data, error } = await supabase.functions.invoke('place-live-order', { body: o });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data.order as OrderAuditRow;
}
