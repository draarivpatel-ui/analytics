// Fakes for the Cloudflare bindings.
export function fakeEnv(over = {}) {
  const points = [];
  const sites = new Map([['flisk.sh', 'odykyi'], ['chat.flisk.si', 'odykyi']]);
  const tokens = new Map();
  const DB = {
    prepare(sql) {
      let args = [];
      const q = {
        bind: (...a) => { args = a; return q; },
        all: async () => (/FROM tokens WHERE owner/.test(sql) ? { results: [...tokens].filter(([, t]) => t.owner === args[0]).map(([hash, t]) => ({ hash, label: t.label, created: t.created })) } : { results: /FROM sites WHERE owner/.test(sql) ? [...sites].filter(([, o]) => o === args[0]).map(([domain]) => ({ domain })) : [...sites.keys()].map((domain) => ({ domain })) }),
        first: async () => (/FROM tokens/.test(sql) ? (tokens.has(args[0]) ? { owner: tokens.get(args[0]).owner } : null) : sites.has(args[0]) ? { owner: sites.get(args[0]) } : null),
        run: async () => {
          // ON CONFLICT(domain) DO NOTHING: an existing domain keeps its owner, and meta.changes
          // reports 1 only when a new row was written, mirroring D1/SQLite.
          if (/INSERT INTO sites/.test(sql)) {
            const existed = sites.has(args[0]);
            if (!existed) sites.set(args[0], args[1]);
            return { meta: { changes: existed ? 0 : 1 } };
          }
          if (/INSERT INTO tokens/.test(sql)) tokens.set(args[0], { owner: args[1], label: args[2], created: args[3] });
          if (/DELETE FROM tokens/.test(sql)) for (const h of [...tokens.keys()]) if (tokens.get(h).owner === args[0] && h.startsWith(args[1])) tokens.delete(h);
          return {};
        },
      };
      return q;
    },
  };
  return { EVENTS: { writeDataPoint: (p) => points.push(p) }, DB, points, sites, tokens, PUBLIC_ORIGIN: 'https://analytics.flisk.si', ALLOWED_LOGINS: 'odykyi', SESSION_SECRET: 's3cret', HASH_SECRET: 'h', DAILY_CAP: '100', ...over };
}
export function fakeCache() {
  const m = new Map();
  return { match: async (k) => { const v = m.get(k.url); return v ? new Response(v) : undefined; }, put: async (k, r) => { m.set(k.url, await r.text()); }, m };
}
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const beacon = (body, headers = {}) => new Request('https://analytics.flisk.si/e', { method: 'POST', headers: { 'user-agent': UA, origin: 'https://flisk.sh', 'cf-connecting-ip': '203.0.113.9', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
