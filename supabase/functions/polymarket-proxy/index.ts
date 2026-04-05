import { corsHeaders } from '@supabase/supabase-js/cors'

const POLYMARKET_BASE = 'https://clob.polymarket.com';

const ALLOWED_PATHS = [
  '/markets',
  '/book',
  '/trades',
  '/trades/recent',
  '/orderbook/summary',
  '/markets/trending',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    const params = url.searchParams.get('params') || '';

    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate endpoint against allowlist
    const isAllowed = ALLOWED_PATHS.some(p => endpoint.startsWith(p));
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Endpoint not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('POLYMARKET_API_KEY') || '';
    const targetUrl = `${POLYMARKET_BASE}${endpoint}${params ? '?' + params : ''}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
    const response = await fetch(targetUrl, { method, headers });

    if (method === 'HEAD') {
      return new Response(null, {
        status: response.ok ? 200 : response.status,
        headers: corsHeaders,
      });
    }

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy request failed', detail: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
