// Reads the dashboard numbers from Analytics Engine through its SQL API.
// Free plan: 10,000 SQL reads a day, so every answer is cached (Cache API, free) and one page load asks for everything at once.

const DATASET = 'flisk_analytics';
export const RANGES = { today: { n: 1, step: 'HOUR', ttl: 60 }, '7d': { n: 7, step: 'DAY', ttl: 300 }, '30d': { n: 30, step: 'DAY', ttl: 600 }, '12m': { n: 365, step: 'WEEK', ttl: 3600 } };
export const PANELS = {
  channels: 'blob3', sources: 'blob2', campaigns: 'blob10', pages: 'blob1',
  countries: 'blob4', regions: 'blob11', cities: 'blob12',
  browsers: 'blob5', os: 'blob6', devices: 'blob7',
};
export const DEFAULT_PANELS = ['channels', 'pages', 'countries', 'browsers'];
const SITE_RE = /^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/;
export const validDomain = (d) => SITE_RE.test(String(d || '')) && d.includes('.');

export async function runSql(env, sql, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'text/plain' },
    body: sql,
  });
  if (!res.ok) throw new Error(`sql ${res.status}`);
  const j = await res.json();
  return j.data || [];
}

const win = (n, prev) => (prev ? `timestamp > NOW() - INTERVAL '${n * 2}' DAY AND timestamp <= NOW() - INTERVAL '${n}' DAY` : `timestamp > NOW() - INTERVAL '${n}' DAY`);
const base = (site, w) => `FROM ${DATASET} WHERE index1 = '${site}' AND ${w}`;
const num = (v) => Number(v) || 0;

const stepMs = { HOUR: 3600e3, DAY: 86400e3, WEEK: 7 * 86400e3 };
const bucketKey = (ms, step) => {
  const d = new Date(ms);
  if (step === 'HOUR') d.setUTCMinutes(0, 0, 0); else d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// Visitors per bucket, with empty buckets filled with 0 so the chart has no holes.
export function fillSeries(rows, range, now = Date.now()) {
  const { n, step } = RANGES[range];
  const count = Math.round((n * 86400e3) / stepMs[step]);
  const have = new Map(rows.map((r) => [String(r.t).slice(0, 19), num(r.v)]));
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * stepMs[step];
    const key = step === 'WEEK' ? [...have.keys()].sort().reverse().find((k) => Date.parse(`${k}Z`) <= t && t - Date.parse(`${k}Z`) < stepMs.WEEK) : bucketKey(t, step);
    out.push({ t: key || bucketKey(t, 'DAY'), v: have.get(key) || 0 });
  }
  return out;
}

async function overview(env, site, range, sql) {
  const { n, step } = RANGES[range];
  const [cur, prev, series, live, sess] = await Promise.all([
    sql(`SELECT SUM(_sample_interval) AS pv, COUNT(DISTINCT blob8) AS uv, COUNT(DISTINCT blob9) AS visits ${base(site, win(n))}`),
    sql(`SELECT SUM(_sample_interval) AS pv, COUNT(DISTINCT blob8) AS uv, COUNT(DISTINCT blob9) AS visits ${base(site, win(n, true))}`),
    sql(`SELECT toStartOfInterval(timestamp, INTERVAL '1' ${step}) AS t, COUNT(DISTINCT blob8) AS v ${base(site, win(n))} GROUP BY t ORDER BY t`),
    sql(`SELECT COUNT(DISTINCT blob8) AS v ${base(site, "timestamp > NOW() - INTERVAL '5' MINUTE")}`),
    // Bounce and duration need a subquery. If Analytics Engine refuses it these two show a dash instead of failing the page.
    sql(`SELECT COUNT() AS sessions, SUM(IF(pv = 1, 1, 0)) AS bounces, AVG(dur) AS dur FROM (SELECT blob9 AS sid, SUM(_sample_interval) AS pv, toUnixTimestamp(MAX(timestamp)) - toUnixTimestamp(MIN(timestamp)) AS dur ${base(site, win(n))} GROUP BY sid)`).catch(() => null),
  ]);
  const a = cur[0] || {}, p = prev[0] || {};
  const metrics = (x, s) => {
    const pv = num(x.pv), visits = num(x.visits);
    return { visitors: num(x.uv), visits, pageviews: pv, viewsPerVisit: visits ? +(pv / visits).toFixed(2) : 0,
      bounceRate: s && num(s.sessions) ? Math.round((num(s.bounces) / num(s.sessions)) * 100) : null, duration: s ? Math.round(num(s.dur)) : null };
  };
  return { current: metrics(a, sess?.[0]), previous: metrics(p, null), series: fillSeries(series, range), live: num(live[0]?.v) };
}

async function panel(env, site, range, key, sql) {
  const col = PANELS[key], { n } = RANGES[range];
  const rows = await sql(`SELECT ${col} AS k, COUNT(DISTINCT blob8) AS v ${base(site, win(n))} AND ${col} != '' GROUP BY k ORDER BY v DESC LIMIT 10`);
  return rows.map((r) => ({ k: String(r.k), v: num(r.v) }));
}

// Each piece (the overview, then every panel) is cached on its own, so opening another tab costs one query, not seven.
async function cached(cache, name, ttl, make) {
  const key = new Request(`https://stats.invalid/${name}`);
  const hit = await cache?.match(key);
  if (hit) return hit.json();
  const value = await make();
  await cache?.put(key, new Response(JSON.stringify(value), { headers: { 'cache-control': `max-age=${ttl}` } })).catch(() => {});
  return value;
}

// `sql` and `cache` are injectable for tests.
export async function siteStats(env, site, range, parts, { sql = (q) => runSql(env, q), cache = globalThis.caches?.default } = {}) {
  if (!validDomain(site) || !RANGES[range]) return null;
  const { ttl } = RANGES[range];
  const want = [...new Set(parts.filter((p) => PANELS[p]))];
  const out = { site, range, ...(await cached(cache, `${site}/${range}/overview`, ttl, () => overview(env, site, range, sql))), panels: {} };
  await Promise.all(want.map(async (p) => { out.panels[p] = await cached(cache, `${site}/${range}/${p}`, ttl, () => panel(env, site, range, p, sql)); }));
  return out;
}

// The sites page: 60 days of daily visitors for every site in one query.
export async function sitesOverview(env, domains, { sql = (q) => runSql(env, q), cache = globalThis.caches?.default } = {}) {
  const list = domains.filter(validDomain).sort();
  if (!list.length) return [];
  return cached(cache, `sites/${list.join(',')}`, 300, async () => {
    const rows = await sql(`SELECT index1 AS site, toStartOfInterval(timestamp, INTERVAL '1' DAY) AS t, COUNT(DISTINCT blob8) AS v FROM ${DATASET} WHERE index1 IN (${list.map((d) => `'${d}'`).join(',')}) AND timestamp > NOW() - INTERVAL '60' DAY GROUP BY site, t ORDER BY t`);
    const now = Date.now();
    return list.map((domain) => {
      const mine = rows.filter((r) => r.site === domain);
      const days = fillSeries(mine, '30d', now).map((d) => d.v);
      const cutoff = now - 30 * 86400e3;
      const before = mine.filter((r) => Date.parse(`${String(r.t).slice(0, 19).replace(' ', 'T')}Z`) <= cutoff).reduce((s, r) => s + num(r.v), 0);
      const total = days.reduce((s, v) => s + v, 0);
      return { domain, total, previous: before, change: before ? Math.round(((total - before) / before) * 100) : null, days };
    });
  });
}
