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
const LISTS = { blob3: [['Direct',817],['Referral',529],['Social',361],['Organic Search',216]], blob2: [['Direct / None',817],['GitHub',529],['X (Twitter)',361],['Google',216],['Hacker News',120]], blob1: [['/',1442],['/docs/quickstart/',649],['/layers/',433],['/agents/',264],['/docs/',192]], blob4: [['Netherlands',745],['India',529],['United States',409],['Germany',192]], blob5: [['Chrome',1394],['Safari',409],['Firefox',240],['Edge',96]], blob6: [['macOS',900],['Windows',700],['Linux',300],['iOS',200]], blob7: [['Desktop',1700],['Mobile',650],['Tablet',60]], blob15: [['github.com/flisk-sh/flisk',212],['news.ycombinator.com/item',64],['x.com/flisk_sh',41],['flisk.sh/downloads/flisk.zip',18]] };
const PATHS = ['/', '/docs/quickstart/', '/layers/', '/agents/', '/docs/'], SRC = ['Direct / None', 'GitHub', 'X (Twitter)', 'Google', 'Hacker News'], CITY = ['Amsterdam', 'Bengaluru', 'Austin', 'Berlin', ''];
const logRows = (n) => Array.from({ length: n }, (_, i) => ({ t: new Date(Date.now() - i * 97e3 - 5e3).toISOString().slice(0, 19).replace('T', ' '), kind: i % 5 === 3 ? 'click' : '', path: PATHS[i % 5], target: i % 5 === 3 ? ['github.com/flisk-sh/flisk', 'x.com/flisk_sh'][i % 2] : '', source: SRC[i % 5], country: ['Netherlands', 'India', 'United States', 'Germany', ''][i % 5], city: CITY[i % 5], browser: ['Chrome', 'Safari', 'Firefox'][i % 3], os: ['macOS', 'Windows', 'Linux'][i % 3], device: 'Desktop', visitor: 'a1b2c3d4e5f6a7b8' }));
// Fake rows per bucket: busier by day, a spike in the last two days, so zoom and hover have something to show.
const seriesRows = (q) => { const step = /INTERVAL '1' (HOUR|DAY|WEEK)/.exec(q)[1], ms = { HOUR: 3600e3, DAY: 86400e3, WEEK: 604800e3 }[step], count = { HOUR: 24 * 60, DAY: 400, WEEK: 60 }[step], top = Math.floor(Date.now() / ms) * ms; return Array.from({ length: count }, (_, i) => { const t = top - i * ms, h = new Date(t).getUTCHours(), base = step === 'HOUR' ? 3 + 5 * Math.sin(((h - 6) / 24) * 2 * Math.PI) ** 2 : step === 'DAY' ? 60 : 400, boost = i < (step === 'HOUR' ? 48 : 3) ? 2.5 : 1, v = Math.round(base * boost * (0.7 + ((i * 7919) % 13) / 20)); return { t: new Date(t).toISOString().slice(0, 19).replace('T', ' '), v: String(v), pv: String(Math.round(v * 1.9)), vs: String(Math.round(v * 1.2)) }; }); };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('analytics_engine/sql')) return realFetch(url, init);
  const q = String(init.body), j = (data) => new Response(JSON.stringify({ data }));
  const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10) + ' 00:00:00';
  if (q.includes('ORDER BY timestamp DESC')) return j(logRows(Number(/LIMIT (\d+)/.exec(q)[1])));
  if (q.includes('GROUP BY k')) { const col = /(blob\d+) AS k/.exec(q)[1]; return j((LISTS[col] || []).map(([k, v]) => ({ k, v: String(v) }))); }
  if (q.includes("index1 IN")) return j([...sites.keys()].flatMap((s, i) => VALS.map((v, n) => ({ site: s, t: day(29 - n), v: String(Math.round(v / (i + 1))) }))));
  if (q.includes('GROUP BY t')) return j(seriesRows(q));
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
