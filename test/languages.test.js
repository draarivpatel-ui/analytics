import { expect, test } from 'bun:test';
import { suggestLanguages } from '../src/languages.js';
import { siteStats } from '../src/stats.js';

const cache = () => { const m = new Map(); return { match: async (r) => m.get(r.url)?.clone(), put: async (r, v) => { m.set(r.url, v); } }; };

test('a South Korean visitor and a .kr scanned domain suggest Korean once', () => {
  const out = suggestLanguages([{ k: 'South Korea', v: 1 }, { k: 'Netherlands', v: 5 }], [{ k: '/', v: 4 }, { k: '/salgoo.kr', v: 1 }, { k: '/ayetech.au', v: 1 }]);
  expect(out.map((x) => x.k)).toEqual(['Dutch', 'Korean']);
  expect(out.find((x) => x.k === 'Korean').n).toContain('.kr domain scanned');
});

test('English is never suggested and a language already served under /ko/ is left out', () => {
  const out = suggestLanguages([{ k: 'South Korea', v: 3 }, { k: 'Australia', v: 2 }], [{ k: '/ko/pricing', v: 1 }]);
  expect(out).toEqual([]);
});

test('the languages panel is built from the countries and the pages', async () => {
  const sql = async (q) => (q.includes('blob4 AS k') ? [{ k: 'Japan', v: '2' }] : q.includes('blob1 AS k') ? [{ k: '/shop.jp', v: '1' }] : q.includes('GROUP BY t') || q.includes('FROM (SELECT') ? [] : [{ pv: '1', uv: '1', visits: '1' }]);
  const out = await siteStats({}, 'citable.flisk.si', '30d', ['languages'], { sql, cache: cache() });
  expect(out.panels.languages).toEqual([{ k: 'Japanese', v: 2, n: '.jp domain scanned, visitors from Japan' }]);
});

test('current visitors comes from its own query, not from the range overview', async () => {
  const seen = [];
  const sql = async (q) => { seen.push(q); return q.includes("INTERVAL '5' MINUTE") ? [{ v: '3' }] : q.includes('GROUP BY t') || q.includes('FROM (SELECT') ? [] : [{ pv: '1', uv: '1', visits: '1' }]; };
  const out = await siteStats({}, 'citable.flisk.si', '30d', [], { sql, cache: cache() });
  expect(out.live).toBe(3);
  expect(seen.filter((q) => q.includes("INTERVAL '5' MINUTE"))).toHaveLength(1);
});

test('the sites list puts the most recently visited site first', async () => {
  const { sitesOverview } = await import('../src/stats.js');
  const sql = async () => ([{ site: 'a.example.com', t: '2026-11-10 00:00:00', v: '1', last: '2026-11-10 10:00:00' }, { site: 'b.example.com', t: '2026-11-18 00:00:00', v: '1', last: '2026-11-18 09:00:00' }]);
  const out = await sitesOverview({}, ['a.example.com', 'b.example.com', 'c.example.com'], { sql, cache: cache() });
  expect(out.map((s) => s.domain)).toEqual(['b.example.com', 'a.example.com', 'c.example.com']);
});

test('the visitor languages panel counts visitors per browser language with their share', async () => {
  const seen = [];
  const sql = async (q) => {
    seen.push(q);
    if (q.includes('blob16 AS k')) return [{ k: 'nl', v: '6' }, { k: 'de', v: '2' }];
    if (q.includes('GROUP BY t') || q.includes('FROM (SELECT')) return [];
    return [{ pv: '10', uv: '10', visits: '10' }];
  };
  const out = await siteStats({}, 'fleet.flisk.si', '30d', ['visitorlangs'], { sql, cache: cache() });
  expect(out.panels.visitorlangs).toEqual([{ k: 'Dutch', code: 'nl', v: 6, n: '60%' }, { k: 'German', code: 'de', v: 2, n: '20%' }]);
  expect(seen.find((q) => q.includes('blob16 AS k'))).toContain("blob16 != ''");
});

test('each site card lists the languages to add: visitor languages without English and without what the site already serves', async () => {
  const { languagesToAdd, flagOf } = await import('../src/languages.js');
  const langs = [{ site: 'fleet.flisk.si', k: 'nl', v: '9' }, { site: 'fleet.flisk.si', k: 'en', v: '50' }, { site: 'flisk.si', k: 'de', v: '4' }, { site: 'flisk.si', k: 'nl', v: '7' }, { site: 'pages.flisk.si', k: 'hi', v: '3' }];
  const paths = [{ site: 'fleet.flisk.si', k: '/nl/docs/' }];
  const out = languagesToAdd(langs, paths);
  expect(out.has('fleet.flisk.si')).toBe(false); // Dutch is already served, English is the baseline
  expect(out.get('flisk.si').map((l) => l.code)).toEqual(['nl', 'de']);
  expect(out.get('pages.flisk.si')).toEqual([{ code: 'hi', name: 'Hindi', flag: '🇮🇳', v: 3 }]);
  expect(flagOf('nl')).toBe('🇳🇱');
});

test('the sites list carries the languages to add and survives a failing language query', async () => {
  const { sitesOverview } = await import('../src/stats.js');
  const sql = async (q) => {
    if (q.includes('blob16 AS k')) return [{ site: 'flisk.si', k: 'de', v: '4' }];
    if (q.includes("LIKE '/__/%'")) throw new Error('nope');
    return [];
  };
  const out = await sitesOverview({}, ['flisk.si'], { sql, cache: cache() });
  expect(out[0].add.map((l) => l.code)).toEqual(['de']);
});
