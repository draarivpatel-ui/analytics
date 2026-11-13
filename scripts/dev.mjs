// Local preview with fake bindings and synthetic numbers. Run: bun scripts/dev.mjs  (http://localhost:8815/dev-login signs you in as odykyi)
import { handle } from '../src/index.js';
import { makeSession } from '../src/session.js';

const PORT = Number(process.env.PORT) || 8815;
const sites = new Map([['flisk.sh', 'odykyi'], ['chat.flisk.si', 'odykyi'], ['fleet.flisk.si', 'odykyi'], ['inference.flisk.si', 'odykyi']]);
const points = [];
const env = {
  PUBLIC_ORIGIN: `http://localhost:${PORT}`, ALLOWED_LOGINS: 'odykyi', SESSION_SECRET: 'dev', HASH_SECRET: 'dev', CF_ACCOUNT_ID: 'x', CF_API_TOKEN: 'x', DAILY_CAP: '1000',
  EVENTS: { writeDataPoint: (p) => { points.push(p); console.log('point', JSON.stringify(p)); } },
  DB: { prepare(sql) { let a = []; const q = { bind: (...x) => { a = x; return q; },
    all: async () => ({ results: [...sites.keys()].map((domain) => ({ domain })) }),
    first: async () => (sites.has(a[0]) ? { owner: sites.get(a[0]) } : null),
    run: async () => { if (/INSERT INTO sites/.test(sql)) sites.set(a[0], a[1]); return {}; } }; return q; } },
};

// Synthetic Analytics Engine answers, so the pages have something to draw.
const VALS = [38,44,41,52,60,47,39,55,63,71,68,59,64,82,91,77,70,66,88,97,104,93,85,99,112,128,121,109,134,147];
const LISTS = { blob3: [['Direct',817],['Referral',529],['Social',361],['Organic Search',216]], blob2: [['Direct / None',817],['GitHub',529],['X (Twitter)',361],['Google',216],['Hacker News',120]], blob1: [['/',1442],['/docs/quickstart/',649],['/layers/',433],['/agents/',264],['/docs/',192]], blob4: [['Netherlands',745],['India',529],['United States',409],['Germany',192]], blob5: [['Chrome',1394],['Safari',409],['Firefox',240],['Edge',96]], blob6: [['macOS',900],['Windows',700],['Linux',300],['iOS',200]], blob7: [['Desktop',1700],['Mobile',650],['Tablet',60]] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('analytics_engine/sql')) return realFetch(url, init);
  const q = String(init.body), j = (data) => new Response(JSON.stringify({ data }));
  const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10) + ' 00:00:00';
  if (q.includes('GROUP BY k')) { const col = /(blob\d+) AS k/.exec(q)[1]; return j((LISTS[col] || []).map(([k, v]) => ({ k, v: String(v) }))); }
  if (q.includes("index1 IN")) return j([...sites.keys()].flatMap((s, i) => VALS.map((v, n) => ({ site: s, t: day(29 - n), v: String(Math.round(v / (i + 1))) }))));
  if (q.includes('GROUP BY t')) return j(VALS.map((v, n) => ({ t: day(29 - n), v: String(v) })));
  if (q.includes('FROM (SELECT')) return j([{ sessions: '3510', bounces: '1440', dur: '132' }]);
  if (q.includes("INTERVAL '5' MINUTE")) return j([{ v: '3' }]);
  return j([{ pv: q.includes('<=') ? '9000' : '11780', uv: q.includes('<=') ? '2040' : '2404', visits: '3510' }]);
};

Bun.serve({ port: PORT, async fetch(req) {
  const u = new URL(req.url);
  if (u.pathname === '/dev-login') return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': await makeSession(env, 'odykyi').then((c) => c.replace('; Secure', '')) } });
  return handle(req, env);
} });
console.log(`analytics dev on http://localhost:${PORT}  (sign in: /dev-login)`);
