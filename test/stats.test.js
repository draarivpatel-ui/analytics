import { expect, test } from 'bun:test';
import { fakeCache } from './helpers.js';
import { fillSeries, sitesOverview, siteStats, validDomain } from '../src/stats.js';

const day = (n, now) => new Date(now - n * 86400e3).toISOString().slice(0, 10) + ' 00:00:00';

test('empty days are filled with zero so the chart has no holes', () => {
  const now = Date.UTC(2026, 10, 13, 15);
  const s = fillSeries([{ t: day(0, now), v: '7' }, { t: day(2, now), v: 3 }], '7d', now);
  expect(s).toHaveLength(7);
  expect(s.at(-1).v).toBe(7);
  expect(s.at(-3).v).toBe(3);
  expect(s.at(-2).v).toBe(0);
});

test('site stats: the five overview queries, then one per panel, and a second call is served from cache', async () => {
  const seen = [];
  const sql = async (q) => {
    seen.push(q);
    if (q.includes('GROUP BY k')) return [{ k: 'GitHub', v: '5' }];
    if (q.includes('GROUP BY t')) return [];
    if (q.includes('FROM (SELECT')) return [{ sessions: '10', bounces: '4', dur: '132' }];
    if (q.includes("INTERVAL '5' MINUTE")) return [{ v: '3' }];
    return [{ pv: '65', uv: '6', visits: '9' }];
  };
  const cache = fakeCache();
  const out = await siteStats({}, 'flisk.sh', '30d', ['sources'], { sql, cache });
  expect(out.current).toEqual({ visitors: 6, visits: 9, pageviews: 65, viewsPerVisit: 7.22, bounceRate: 40, duration: 132 });
  expect(out.live).toBe(3);
  expect(out.panels.sources).toEqual([{ k: 'GitHub', v: 5 }]);
  expect(seen).toHaveLength(6);
  await siteStats({}, 'flisk.sh', '30d', ['sources'], { sql, cache });
  expect(seen).toHaveLength(6); // all cached
  await siteStats({}, 'flisk.sh', '30d', ['sources', 'pages'], { sql, cache });
  expect(seen).toHaveLength(7); // only the new panel asked
  expect(seen.every((q) => q.includes("index1 = 'flisk.sh'") || q.includes('FROM ('))).toBe(true);
});

test('a refused subquery shows dashes for bounce and duration instead of failing', async () => {
  const sql = async (q) => { if (q.includes('FROM (SELECT')) throw new Error('nope'); if (q.includes('GROUP BY t')) return []; return [{ pv: 1, uv: 1, visits: 1, v: 0 }]; };
  const out = await siteStats({}, 'flisk.sh', 'today', [], { sql, cache: fakeCache() });
  expect(out.current.bounceRate).toBeNull();
  expect(out.current.duration).toBeNull();
});

test('a domain that could break out of the SQL string is refused before any query', async () => {
  let asked = 0;
  const sql = async () => { asked++; return []; };
  for (const bad of ["x' OR '1'='1", 'a b.com', 'nodot', '', "flisk.sh'--"]) {
    expect(validDomain(bad)).toBe(false);
    expect(await siteStats({}, bad, '30d', [], { sql, cache: fakeCache() })).toBeNull();
  }
  expect(await siteStats({}, 'flisk.sh', 'forever', [], { sql, cache: fakeCache() })).toBeNull();
  expect(asked).toBe(0);
});

test('the sites page asks for every site in one query', async () => {
  const now = Date.now();
  let n = 0;
  const sql = async () => { n++; return [{ site: 'flisk.sh', t: day(0, now), v: '4' }, { site: 'flisk.sh', t: day(45, now), v: '2' }]; };
  const out = await sitesOverview({}, ['flisk.sh', 'chat.flisk.si'], { sql, cache: fakeCache() });
  expect(n).toBe(1);
  expect(out.find((s) => s.domain === 'flisk.sh')).toMatchObject({ total: 4, previous: 2, change: 100 });
  expect(out.find((s) => s.domain === 'chat.flisk.si')).toMatchObject({ total: 0, change: null });
  expect(out[0].days).toHaveLength(30);
});
