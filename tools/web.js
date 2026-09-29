/* Web tools: outbound HTTP reads + langsearch.com web search. */

export const webTool = {
  id: 'web',
  title: 'Web',
  description: 'Read any HTTP API or URL, and search the web via langsearch.com.',
  tools: [
    {
      name: 'web_fetch',
      description:
        'Perform an HTTP request to any URL and return the response body. ' +
        'Use this to read public APIs, fetch JSON, HTML, or plain text. ' +
        'Methods: GET (default) and POST.',
      parameters: {
        type: 'object',
        properties: {
          url:     { type: 'string', description: 'Absolute URL (https://…)' },
          method:  { type: 'string', description: 'GET or POST (default GET)' },
          headers: { type: 'object', description: 'Optional request headers' },
          body:    { type: 'string', description: 'Optional request body (POST)' }
        },
        required: ['url']
      },
      risk: 'low',
      timeoutMs: 25_000,
      async handler({ url, method, headers, body }, signal, ctx) {
        if (!ctx?.config?.security?.allowWebFetch) {
          return { ok: false, error: { code: 'web_access_disabled', message: 'Outbound web access is disabled in Settings → Security.' } };
        }
        if (!/^https?:\/\//i.test(url)) {
          return { ok: false, error: { code: 'bad_url', message: 'URL must start with http:// or https://' } };
        }
        const m = (method || 'GET').toUpperCase();
        const res = await fetch(url, {
          method: m,
          headers: { Accept: 'application/json, text/plain, text/html, */*', ...(headers || {}) },
          body: m === 'POST' && body ? body : undefined,
          signal
        });
        const ct = res.headers.get('content-type') || '';
        const text = await res.text();
        const limit = 200_000;
        const truncated = text.length > limit;
        return {
          status: res.status,
          contentType: ct,
          truncated,
          body: text.slice(0, limit)
        };
      }
    },
    {
      name: 'web_search',
      description: 'Search the web using the langsearch.com API. Requires an API key from Settings.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'integer', description: 'Number of results (1–10, default 5)' }
        },
        required: ['query']
      },
      risk: 'low',
      timeoutMs: 20_000,
      async handler({ query, count = 5 }, signal, ctx) {
        if (!ctx?.config?.security?.allowWebFetch) {
          return { ok: false, error: { code: 'web_access_disabled', message: 'Outbound web access is disabled.' } };
        }
        const key = ctx?.config?.webSearchApiKey;
        if (!key) {
          return { ok: false, error: { code: 'no_api_key', message: 'Add a langsearch.com API key in Settings → General.' } };
        }
        const res = await fetch('https://api.langsearch.com/v1/web-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            query,
            freshness: 'noLimit',
            summary: false,
            count: Math.max(1, Math.min(10, count | 0))
          }),
          signal
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          return { ok: false, error: { code: `http_${res.status}`, message: t.slice(0, 300) } };
        }
        const data = await res.json();
        const pages = data?.data?.webPages?.value || data?.webPages?.value || [];
        return pages.map((p) => ({
          title: p.name || p.title,
          url: p.url,
          snippet: p.snippet
        }));
      }
    }
  ]
};