// Reads the dashboard numbers from Analytics Engine through its SQL API.
// Free plan: 10,000 SQL reads a day, so every answer is cached (Cache API, free) and one page load asks for everything at once.

const DATASET = 'flisk_analytics';
export const RANGES = { today: { n: 1, step: 'HOUR', ttl: 60 }, '7d': { n: 7, step: 'DAY', ttl: 300 }, '30d': { n: 30, step: 'DAY', ttl: 600 }, '12m': { n: 365, step: 'WEEK', ttl: 3600 } };
export const PANELS = {
  channels: 'blob3', sources: 'blob2', campaigns: 'blob10', themes: 'blob13', pages: 'blob1',
  countries: 'blob4', regions: 'blob11', cities: 'blob12',
  browsers: 'blob5', os: 'blob6', devices: 'blob7', links: 'blob15',
};
// Link clicks are their own data points (blob14 = 'click'); everything else counts pageviews only (blob14 = '').
const KIND = { links: 'click' };
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

// A window is a preset ({ n } days back from now) or a custom { from, to } in epoch ms, already rounded to whole hours.
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const win = (w, prev) => {
  if (w.from != null) {
    const span = w.to - w.from;
    return prev ? `timestamp >= toDateTime('${sqlTime(w.from - span)}') AND timestamp < toDateTime('${sqlTime(w.from)}')` : `timestamp >= toDateTime('${sqlTime(w.from)}') AND timestamp < toDateTime('${sqlTime(w.to)}')`;
  }
  return prev ? `timestamp > NOW() - INTERVAL '${w.n * 2}' DAY AND timestamp <= NOW() - INTERVAL '${w.n}' DAY` : `timestamp > NOW() - INTERVAL '${w.n}' DAY`;
};
const base = (site, w, kind = '') => `FROM ${DATASET} WHERE index1 = '${site}' AND blob14 = '${kind}' AND ${w}`;
const num = (v) => Number(v) || 0;

const stepMs = { HOUR: 3600e3, DAY: 86400e3, WEEK: 7 * 86400e3 };
const bucketKey = (ms, step) => {
  const d = new Date(ms);
  if (step === 'HOUR') d.setUTCMinutes(0, 0, 0); else d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const STEPS = { hour: 'HOUR', day: 'DAY', week: 'WEEK' };
const MAX_BUCKETS = 800;

// Turn the request (a preset, or a custom from/to, and an optional interval) into one plain window.
// Custom windows are rounded out to whole hours so the cache key is stable and the buckets line up.
export function resolveWindow({ range = '30d', from, to, by } = {}, now = Date.now()) {
  let w;
  if (from != null && to != null && from !== '' && to !== '') {
    let f = Math.floor(Number(from) / 3600e3) * 3600e3, t = Math.ceil(Number(to) / 3600e3) * 3600e3;
    if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f || t - f > 400 * 86400e3 || t > now + 3600e3) return null;
    const span = t - f;
    w = { from: f, to: t, count: 0, step: span <= 8 * 86400e3 ? 'HOUR' : span <= 120 * 86400e3 ? 'DAY' : 'WEEK', ttl: 300, key: `c${f / 1000}-${t / 1000}` };
  } else {
    const r = RANGES[range];
    if (!r) return null;
    w = { n: r.n, step: r.step, ttl: r.ttl, key: range };
  }
  const span = w.from != null ? w.to - w.from : w.n * 86400e3;
  let step = STEPS[String(by || '').toLowerCase()] || w.step;
  while (span / stepMs[step] > MAX_BUCKETS && step !== 'WEEK') step = step === 'HOUR' ? 'DAY' : 'WEEK';
  w.step = step;
  w.count = Math.max(1, Math.round(span / stepMs[step]));
  w.end = w.from != null ? w.to - 1 : now;
  w.key += `/${step}`;
  return w;
}

// Visitors, visits and pageviews per bucket, with empty buckets filled with 0 so the chart has no holes.
export function fillBuckets(rows, step, count, now = Date.now()) {
  const have = new Map(rows.map((r) => [String(r.t).slice(0, 19), { v: num(r.v), pv: num(r.pv ?? r.v), vs: num(r.vs ?? r.v) }]));
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = now - i * stepMs[step];
    const key = step === 'WEEK' ? [...have.keys()].sort().reverse().find((k) => Date.parse(`${k.replace(' ', 'T')}Z`) <= t && t - Date.parse(`${k.replace(' ', 'T')}Z`) < stepMs.WEEK) : bucketKey(t, step);
    out.push({ t: key || bucketKey(t, 'DAY'), ...(have.get(key) || { v: 0, pv: 0, vs: 0 }) });
  }
  return out;
}
export function fillSeries(rows, range, now = Date.now()) {
  const { n, step } = RANGES[range];
  return fillBuckets(rows, step, Math.round((n * 86400e3) / stepMs[step]), now);
}

async function overview(env, site, w, sql) {
  const { step } = w;
  const [cur, prev, series, live, sess] = await Promise.all([
    sql(`SELECT SUM(_sample_interval) AS pv, COUNT(DISTINCT blob8) AS uv, COUNT(DISTINCT blob9) AS visits ${base(site, win(w))}`),
    sql(`SELECT SUM(_sample_interval) AS pv, COUNT(DISTINCT blob8) AS uv, COUNT(DISTINCT blob9) AS visits ${base(site, win(w, true))}`),
    sql(`SELECT toStartOfInterval(timestamp, INTERVAL '1' ${step}) AS t, COUNT(DISTINCT blob8) AS v, SUM(_sample_interval) AS pv, COUNT(DISTINCT blob9) AS vs ${base(site, win(w))} GROUP BY t ORDER BY t`),
    sql(`SELECT COUNT(DISTINCT blob8) AS v ${base(site, "timestamp > NOW() - INTERVAL '5' MINUTE")}`),
    // Bounce and duration need a subquery. If Analytics Engine refuses it these two show a dash instead of failing the page.
    sql(`SELECT COUNT() AS sessions, SUM(IF(pv = 1, 1, 0)) AS bounces, AVG(dur) AS dur FROM (SELECT blob9 AS sid, SUM(_sample_interval) AS pv, toUnixTimestamp(MAX(timestamp)) - toUnixTimestamp(MIN(timestamp)) AS dur ${base(site, win(w))} GROUP BY sid)`).catch(() => null),
  ]);
  const a = cur[0] || {}, p = prev[0] || {};
  const metrics = (x, s) => {
    const pv = num(x.pv), visits = num(x.visits);
    return { visitors: num(x.uv), visits, pageviews: pv, viewsPerVisit: visits ? +(pv / visits).toFixed(2) : 0,
      bounceRate: s && num(s.sessions) ? Math.round((num(s.bounces) / num(s.sessions)) * 100) : null, duration: s ? Math.round(num(s.dur)) : null };
  };
  return { current: metrics(a, sess?.[0]), previous: metrics(p, null), step: step.toLowerCase(), from: w.from ?? null, to: w.to ?? null, series: fillBuckets(series, step, w.count, w.end), live: num(live[0]?.v) };
}

async function panel(env, site, w, key, sql) {
  const col = PANELS[key], kind = KIND[key] || '';
  const agg = kind ? 'SUM(_sample_interval)' : 'COUNT(DISTINCT blob8)';
  const rows = await sql(`SELECT ${col} AS k, ${agg} AS v ${base(site, win(w), kind)} AND ${col} != '' GROUP BY k ORDER BY v DESC LIMIT 10`);
  return rows.map((r) => ({ k: String(r.k), v: num(r.v) }));
}

// The newest events, pageviews and link clicks together, for the activity log. Looks back at most 7 days.
export async function siteLogs(env, site, { limit = 50, kind = '' } = {}, { sql = (q) => runSql(env, q), cache = globalThis.caches?.default } = {}) {
  if (!validDomain(site)) return null;
  const n = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 200);
  const only = kind === 'click' ? "AND blob14 = 'click'" : kind === 'pageview' ? "AND blob14 = ''" : '';
  return cached(cache, `${site}/logs/${n}/${kind || 'all'}`, 20, async () => {
    const rows = await sql(`SELECT timestamp AS t, blob14 AS kind, blob1 AS path, blob15 AS target, blob2 AS source, blob4 AS country, blob12 AS city, blob5 AS browser, blob6 AS os, blob7 AS device, blob8 AS visitor FROM ${DATASET} WHERE index1 = '${site}' ${only} AND timestamp > NOW() - INTERVAL '7' DAY ORDER BY timestamp DESC LIMIT ${n}`);
    return rows.map((r) => ({ t: `${String(r.t).slice(0, 19).replace(' ', 'T')}Z`, kind: r.kind === 'click' ? 'click' : 'pageview', path: String(r.path || ''), target: String(r.target || ''), source: String(r.source || ''), country: String(r.country || ''), city: String(r.city || ''), browser: String(r.browser || ''), os: String(r.os || ''), device: String(r.device || ''), visitor: String(r.visitor || '').slice(0, 6) }));
  });
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

// `sql` and `cache` are injectable for tests. `from`, `to` (epoch ms) and `by` (hour, day or week) pick a custom window and interval.
export async function siteStats(env, site, range, parts, { sql = (q) => runSql(env, q), cache = globalThis.caches?.default, from, to, by } = {}) {
  if (!validDomain(site)) return null;
  const w = resolveWindow({ range, from, to, by });
  if (!w) return null;
  const want = [...new Set(parts.filter((p) => PANELS[p]))];
  const out = { site, range: w.from != null ? 'custom' : range, ...(await cached(cache, `${site}/${w.key}/overview`, w.ttl, () => overview(env, site, w, sql))), panels: {} };
  await Promise.all(want.map(async (p) => { out.panels[p] = await cached(cache, `${site}/${w.key}/${p}`, w.ttl, () => panel(env, site, w, p, sql)); }));
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
