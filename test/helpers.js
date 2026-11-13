// Fakes for the Cloudflare bindings.
export function fakeEnv(over = {}) {
  const points = [];
  const sites = new Map([['flisk.sh', 'odykyi'], ['chat.flisk.si', 'odykyi']]);
  const DB = {
    prepare(sql) {
      let args = [];
      const q = {
        bind: (...a) => { args = a; return q; },
        all: async () => ({ results: /FROM sites WHERE owner/.test(sql) ? [...sites].filter(([, o]) => o === args[0]).map(([domain]) => ({ domain })) : [...sites.keys()].map((domain) => ({ domain })) }),
        first: async () => (sites.has(args[0]) ? { owner: sites.get(args[0]) } : null),
        run: async () => { if (/INSERT INTO sites/.test(sql)) sites.set(args[0], args[1]); return {}; },
      };
      return q;
    },
  };
  return { EVENTS: { writeDataPoint: (p) => points.push(p) }, DB, points, sites, PUBLIC_ORIGIN: 'https://analytics.flisk.si', ALLOWED_LOGINS: 'odykyi', SESSION_SECRET: 's3cret', HASH_SECRET: 'h', DAILY_CAP: '100', ...over };
}
export function fakeCache() {
  const m = new Map();
  return { match: async (k) => { const v = m.get(k.url); return v ? new Response(v) : undefined; }, put: async (k, r) => { m.set(k.url, await r.text()); }, m };
}
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const beacon = (body, headers = {}) => new Request('https://analytics.flisk.si/e', { method: 'POST', headers: { 'user-agent': UA, origin: 'https://flisk.sh', 'cf-connecting-ip': '203.0.113.9', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
