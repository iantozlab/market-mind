const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const ALLOWED_PATHS = [
  '/markets',
  '/gamma/markets', // Gamma API: supports active=true filtering
  '/gamma/events',
  '/book',
  '/trades',
  '/trades/recent',
  '/orderbook/summary',
  '/markets/trending',
  '/__config',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { endpoint, params, method: upstreamMethod } = body as {
      endpoint: string;
      params?: string;
      method?: string;
    };

    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Special internal endpoint: return server-side config
    if (endpoint === '/__config') {
      const config = {
        polygonRpcUrl: Deno.env.get('POLYGON_RPC_URL') || '',
        blocknativeApiKey: Deno.env.get('BLOCKNATIVE_API_KEY') || '',
        polymarketApiKey: !!Deno.env.get('POLYMARKET_API_KEY'),
      };
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isAllowed = ALLOWED_PATHS.some(p => endpoint.startsWith(p));
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Endpoint not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isGamma = endpoint.startsWith('/gamma/');
    const upstreamPath = isGamma ? endpoint.replace('/gamma', '') : endpoint;
    const base = isGamma ? GAMMA_BASE : CLOB_BASE;
    const targetUrl = `${base}${upstreamPath}${params ? '?' + params : ''}`;

    // Public CLOB and Gamma endpoints do not require an API key.
    // Sending a Bearer token causes 401 if the key isn't a valid CLOB L2 credential.
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    const fetchMethod = upstreamMethod === 'HEAD' ? 'HEAD' : 'GET';
    // 8s upstream timeout to avoid hanging the client
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(targetUrl, { method: fetchMethod, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (fetchMethod === 'HEAD') {
      return new Response(JSON.stringify({ ok: response.ok, status: response.status }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.text();
    return new Response(JSON.stringify({
      ok: response.ok,
      status: response.status,
      body: data,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy request failed', detail: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
