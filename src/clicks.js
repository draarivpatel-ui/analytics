// Click map: where people click on each page, and what they click. Same rows and answer as grow.flisk.si.
// Anonymous: no IP, no visitor hash, no session id. A field is stored by its kind, never its text.
// D1 free plan: 100,000 rows written a day, shared with the rest of the account. Each click writes one row
// and one index entry, so CLICKS_PER_DAY (default 20,000) keeps clicks well under half of that.

const DAY_MS = 864e5;
export const DEVS = new Set(['mobile', 'desktop']);
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
// A page path: no query, no hash. Anything that does not start with / is the home page.
export const cleanPage = (p) => { const s = str(p, 200); return s.startsWith('/') ? s.split('?')[0].split('#')[0] || '/' : '/'; };

// One batch from a.js: { e: 'clicks', d, p, v: 'mobile'|'desktop', c: [{ x: 0..1, y: px, k: 'ctl'|'dead', t }] }.
// Returns the rows to write, or [] when the batch is not usable.
export function cleanClicks(b) {
  const dev = str(b?.v, 10);
  if (!DEVS.has(dev) || !Array.isArray(b?.c)) return [];
  const page = cleanPage(b?.p);
  return b.c.slice(0, 30)
    .map((c) => ({ x: Math.round(Number(c?.x) * 100), y: Math.round(Number(c?.y)), k: c?.k === 'ctl' ? 'ctl' : 'dead', t: str(c?.t, 40) }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.x >= 0 && c.x <= 100 && c.y >= 0 && c.y < 100000)
    .map((c) => ({ page, dev, ...c }));
}

// Writes one batch for a site that the caller already checked. Past the daily cap nothing is written.
export async function recordClicks(env, site, b, now = Date.now()) {
  const list = cleanClicks(b);
  if (!list.length) return 0;
  const day = new Date(now).toISOString().slice(0, 10);
  const cap = Number(env.CLICKS_PER_DAY) || 20000;
  const row = await env.DB.prepare('SELECT n FROM click_days WHERE day = ?').bind(day).first();
  if ((row?.n || 0) + list.length > cap) return 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO click_days (day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + ?').bind(day, list.length, list.length),
    ...list.map((c) => env.DB.prepare('INSERT INTO clicks (site, day, page, dev, x, y, kind, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(site, day, c.page, c.dev, c.x, c.y, c.k, c.t)),
  ]);
  return list.length;
}

// GET /api/clicks?site&page&dev&days, in Grow's shape: { page, dev, since, clicks, dead, targets, cells }.
// Cells are 5% of the page width by 50 px of height.
export async function clickMap(env, site, params, now = Date.now()) {
  const page = cleanPage(params.get('page') || '/');
  const dev = DEVS.has(params.get('dev')) ? params.get('dev') : 'mobile';
  const days = Math.min(30, Math.max(1, Math.floor(Number(params.get('days'))) || 7));
  const since = new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const q = (sql) => env.DB.prepare(sql).bind(site, page, dev, since).all().then((r) => r.results || []);
  const where = 'FROM clicks WHERE site = ? AND page = ? AND dev = ? AND day >= ?';
  const [targets, cells, total] = await Promise.all([
    q(`SELECT target, kind, COUNT(*) AS n ${where} GROUP BY target, kind ORDER BY n DESC LIMIT 40`),
    q(`SELECT x / 5 AS cx, y / 50 AS cy, COUNT(*) AS n ${where} GROUP BY cx, cy`),
    q(`SELECT COUNT(*) AS n, SUM(kind = 'dead') AS dead ${where}`),
  ]);
  return {
    page, dev, since,
    clicks: total[0]?.n || 0,
    dead: total[0]?.dead || 0,
    targets: targets.map((t) => ({ target: t.target, kind: t.kind, n: t.n })),
    cells: cells.map((c) => ({ x: c.cx * 5, y: c.cy * 50, n: c.n })),
  };
}
