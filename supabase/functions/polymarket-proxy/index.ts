const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const ALLOWED_PATHS = [
  '/markets',
  '/gamma/markets',
  '/gamma/events',
  '/book',
  '/trades',
  '/trades/recent',
  '/orderbook/summary',
  '/markets/trending',
  '/__config',
];

function logJson(level: 'info' | 'warn' | 'error', payload: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...payload });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

function truncate(s: string | undefined | null, n: number) {
  if (!s) return s ?? null;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = shortId();
  let endpoint = '';
  let params: string | undefined;
  let upstreamMethod: string | undefined;

  try {
    const body = await req.json();
    ({ endpoint, params, method: upstreamMethod } = body as {
      endpoint: string;
      params?: string;
      method?: string;
    });

    if (!endpoint) {
      logJson('warn', { event: 'invalid_input', requestId, reason: 'missing_endpoint' });
      return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (endpoint === '/__config') {
      const polygon = !!Deno.env.get('POLYGON_RPC_URL');
      const blocknative = !!Deno.env.get('BLOCKNATIVE_API_KEY');
      const polymarket = !!Deno.env.get('POLYMARKET_API_KEY');
      logJson('info', {
        event: 'config_request',
        requestId,
        present: { polygon, blocknative, polymarket },
      });
      const config = {
        polygonRpcUrl: Deno.env.get('POLYGON_RPC_URL') || '',
        blocknativeApiKey: Deno.env.get('BLOCKNATIVE_API_KEY') || '',
        polymarketApiKey: polymarket,
      };
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isAllowed = ALLOWED_PATHS.some((p) => endpoint.startsWith(p));
    if (!isAllowed) {
      logJson('warn', { event: 'disallowed_endpoint', requestId, endpoint });
      return new Response(JSON.stringify({ error: 'Endpoint not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isGamma = endpoint.startsWith('/gamma/');
    const upstreamPath = isGamma ? endpoint.replace('/gamma', '') : endpoint;
    const base = isGamma ? GAMMA_BASE : CLOB_BASE;
    const targetUrl = `${base}${upstreamPath}${params ? '?' + params : ''}`;
    const fetchMethod = upstreamMethod === 'HEAD' ? 'HEAD' : 'GET';

    logJson('info', {
      event: 'upstream_request',
      requestId,
      endpoint,
      method: fetchMethod,
      isGamma,
      params: truncate(params ?? null, 500),
      targetUrl,
    });

    const headers: Record<string, string> = { Accept: 'application/json' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(targetUrl, { method: fetchMethod, headers, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const isAbort = (err as Error)?.name === 'AbortError';
      logJson('error', {
        event: isAbort ? 'upstream_timeout' : 'upstream_fetch_error',
        requestId,
        endpoint,
        targetUrl,
        durationMs,
        errorName: (err as Error)?.name,
        errorMessage: (err as Error)?.message,
      });
      throw err;
    }
    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;

    if (fetchMethod === 'HEAD') {
      logJson('info', {
        event: 'upstream_response',
        requestId,
        endpoint,
        status: response.status,
        durationMs,
        head: true,
      });
      return new Response(JSON.stringify({ ok: response.ok, status: response.status }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.text();

    if (response.ok) {
      logJson('info', {
        event: 'upstream_response',
        requestId,
        endpoint,
        status: response.status,
        durationMs,
        bodyBytes: data.length,
      });
    } else {
      const level = response.status >= 500 ? 'error' : 'warn';
      logJson(level, {
        event: 'upstream_error',
        requestId,
        endpoint,
        targetUrl,
        params: truncate(params ?? null, 500),
        status: response.status,
        durationMs,
        bodySnippet: truncate(data, 500),
      });
    }

    return new Response(JSON.stringify({
      ok: response.ok,
      status: response.status,
      body: data,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logJson('error', {
      event: 'proxy_exception',
      requestId,
      endpoint,
      params: truncate(params ?? null, 500),
      method: upstreamMethod,
      errorName: (error as Error)?.name,
      errorMessage: (error as Error)?.message,
    });
    return new Response(JSON.stringify({ error: 'Proxy request failed', detail: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
