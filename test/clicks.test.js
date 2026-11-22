import { beforeEach, expect, test } from 'bun:test';
import { handleBeacon, resetSitesCache } from '../src/ingest.js';
import { cleanClicks, clickMap } from '../src/clicks.js';
import { handle } from '../src/index.js';
import { makeSession } from '../src/session.js';
import { createToken } from '../src/tokens.js';
import { beacon, fakeEnv, sqliteD1 } from './helpers.js';

beforeEach(() => resetSitesCache());

const env = (over = {}) => fakeEnv({ DB: sqliteD1(), ...over });
const rows = (e) => e.DB.db.query('SELECT site, day, page, dev, x, y, kind, target FROM clicks ORDER BY rowid').all();
const batch = (c, over = {}) => ({ d: 'flisk.sh', e: 'clicks', p: '/docs/?q=1#a', v: 'desktop', s: 'sid', c, ...over });
const NOW = Date.parse('2026-11-22T12:00:00Z');

test('a click batch writes one D1 row per click, with position, kind and target, and no visitor data', async () => {
  const e = env();
  const res = await handleBeacon(beacon(batch([{ x: 0.5, y: 320, k: 'ctl', t: 'Get started' }, { x: 0.123, y: 1200.4, k: 'dead', t: 'div' }])), e, NOW);
  expect(res.status).toBe(204);
  expect(rows(e)).toEqual([
    { site: 'flisk.sh', day: '2026-11-22', page: '/docs/', dev: 'desktop', x: 50, y: 320, kind: 'ctl', target: 'Get started' },
    { site: 'flisk.sh', day: '2026-11-22', page: '/docs/', dev: 'desktop', x: 12, y: 1200, kind: 'dead', target: 'div' },
  ]);
  expect(e.points).toHaveLength(0); // not an Analytics Engine data point
  expect(JSON.stringify(e.DB.db.query('SELECT * FROM clicks').all())).not.toMatch(/203\.0\.113\.9|sid/);
});

test('bad clicks are dropped: out of range, unknown kind becomes dead, long labels clipped, at most 30 per batch', () => {
  expect(cleanClicks({ v: 'tablet', c: [{ x: 0.5, y: 1 }] })).toEqual([]);
  expect(cleanClicks({ v: 'mobile', c: 'no' })).toEqual([]);
  const out = cleanClicks({ v: 'mobile', p: 'nope', c: [{ x: 1.5, y: 1 }, { x: -0.1, y: 1 }, { x: 0.2, y: -3 }, { x: 'a', y: 1 }, { x: 0.2, y: 4, k: 'weird', t: 'x'.repeat(99) }] });
  expect(out).toEqual([{ page: '/', dev: 'mobile', x: 20, y: 4, k: 'dead', t: 'x'.repeat(40) }]);
  expect(cleanClicks({ v: 'mobile', c: Array.from({ length: 50 }, () => ({ x: 0.1, y: 1 })) })).toHaveLength(30);
});

test('clicks from bots, unknown sites, wrong origins, Do Not Track and Global Privacy Control are not stored', async () => {
  const e = env();
  const one = [{ x: 0.5, y: 10, k: 'ctl', t: 'a' }];
  for (const req of [
    beacon(batch(one), { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' }),
    beacon(batch(one, { d: 'evil.example' })),
    beacon(batch(one), { origin: 'https://evil.example' }),
    beacon(batch(one), { dnt: '1' }),
    beacon(batch(one), { 'sec-gpc': '1' }),
  ]) expect((await handleBeacon(req, e, NOW)).status).toBe(204);
  expect(rows(e)).toHaveLength(0);
});

test('past CLICKS_PER_DAY nothing more is written that day; the next day starts again', async () => {
  const e = env({ CLICKS_PER_DAY: '3' });
  const two = [{ x: 0.1, y: 1 }, { x: 0.2, y: 2 }];
  await handleBeacon(beacon(batch(two)), e, NOW);
  await handleBeacon(beacon(batch(two)), e, NOW); // 2 + 2 > 3: refused whole
  expect(rows(e)).toHaveLength(2);
  await handleBeacon(beacon(batch(two)), e, NOW + 864e5);
  expect(rows(e)).toHaveLength(4);
});

test('click batches do not use up the pageview cap', async () => {
  const e = env({ DAILY_CAP: '1' });
  for (let i = 0; i < 3; i++) await handleBeacon(beacon(batch([{ x: 0.1, y: 1 }])), e, NOW);
  await handleBeacon(beacon({ d: 'flisk.sh', p: '/' }), e, NOW);
  expect(rows(e)).toHaveLength(3);
  expect(e.points).toHaveLength(1);
});

test('a broken click table never breaks the beacon', async () => {
  const e = env();
  e.DB.db.exec('DROP TABLE clicks');
  expect((await handleBeacon(beacon(batch([{ x: 0.1, y: 1 }])), e, NOW)).status).toBe(204);
});

test('clickMap answers in Grow\'s shape, filtered by site, page, device and days', async () => {
  const e = env();
  const ins = e.DB.db.query('INSERT INTO clicks (site, day, page, dev, x, y, kind, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('flisk.sh', '2026-11-22', '/', 'mobile', 12, 120, 'ctl', 'Start');
  ins.run('flisk.sh', '2026-11-21', '/', 'mobile', 13, 140, 'ctl', 'Start');
  ins.run('flisk.sh', '2026-11-20', '/', 'mobile', 80, 900, 'dead', 'p');
  ins.run('flisk.sh', '2026-11-01', '/', 'mobile', 50, 50, 'dead', 'old'); // outside 7 days
  ins.run('flisk.sh', '2026-11-22', '/', 'desktop', 50, 50, 'ctl', 'desk');
  ins.run('flisk.sh', '2026-11-22', '/docs/', 'mobile', 50, 50, 'ctl', 'docs');
  ins.run('chat.flisk.si', '2026-11-22', '/', 'mobile', 50, 50, 'ctl', 'chat');
  const out = await clickMap(e, 'flisk.sh', new URLSearchParams('page=/&dev=mobile&days=7'), NOW);
  expect(out).toEqual({
    page: '/', dev: 'mobile', since: '2026-11-16', clicks: 3, dead: 1,
    targets: [{ target: 'Start', kind: 'ctl', n: 2 }, { target: 'p', kind: 'dead', n: 1 }],
    cells: expect.arrayContaining([{ x: 10, y: 100, n: 2 }, { x: 80, y: 900, n: 1 }]),
  });
  expect(out.cells).toHaveLength(2);
  const def = await clickMap(e, 'flisk.sh', new URLSearchParams('days=999&dev=tv'), NOW);
  expect([def.page, def.dev, def.since]).toEqual(['/', 'mobile', '2026-10-24']); // defaults, days capped at 30
});

const get = async (e, path, headers) => handle(new Request(`https://analytics.flisk.si${path}`, { headers }), e);

test('GET /api/clicks needs a sign-in or key and an owned site', async () => {
  const e = env();
  e.DB.db.query("INSERT INTO clicks (site, day, page, dev, x, y, kind, target) VALUES ('flisk.sh', ?, '/', 'mobile', 10, 10, 'ctl', 'Go')").run(new Date().toISOString().slice(0, 10));
  expect((await get(e, '/api/clicks?site=flisk.sh')).status).toBe(401);
  const cookie = (await makeSession(e, 'odykyi')).split(';')[0];
  const res = await get(e, '/api/clicks?site=flisk.sh&page=/&dev=mobile&days=7', { cookie });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body)).toEqual(['page', 'dev', 'since', 'clicks', 'dead', 'targets', 'cells']);
  expect(body.clicks).toBe(1);
  expect(body.targets).toEqual([{ target: 'Go', kind: 'ctl', n: 1 }]);
  expect((await get(e, '/api/clicks?site=theirs.example', { cookie })).status).toBe(404);
  expect((await get(e, '/api/clicks?site=nope', { cookie })).status).toBe(404);
  e.DB.db.exec('DROP TABLE clicks');
  expect((await get(e, '/api/clicks?site=flisk.sh', { cookie })).status).toBe(502);
});

test('GET /api/clicks works with an API key (what gel click-map sends)', async () => {
  const e = env();
  const made = await createToken(e, 'odykyi', 'gel');
  const res = await get(e, '/api/clicks?site=flisk.sh', { authorization: `Bearer ${made.token}` });
  expect(res.status).toBe(200);
  expect((await res.json()).clicks).toBe(0);
});

test('a.js records every click with its place, batches them, and stays quiet under Do Not Track or GPC', async () => {
  const src = await Bun.file(new URL('../public/a.js', import.meta.url)).text();
  const run = (nav = {}, loc = {}) => {
    const sent = [], on = {};
    const script = { getAttribute: (k) => (k === 'data-domain' ? 'x.flisk.si' : null) };
    const document = { currentScript: script, documentElement: { getAttribute: () => null, scrollWidth: 1000 }, referrer: '', visibilityState: 'visible', addEventListener() {} };
    const g = { document, navigator: { userAgent: 'Chrome', sendBeacon: (_u, b) => { sent.push(JSON.parse(b)); return true; }, ...nav }, location: { pathname: '/', search: '', href: 'https://x.flisk.si/', host: 'x.flisk.si', ...loc }, history: {}, sessionStorage: { getItem: () => 'sid', setItem() {} }, addEventListener: (k, f) => { (on[k] ||= []).push(f); }, innerWidth: 400, URL, URLSearchParams, setTimeout, JSON, String, Math, RegExp };
    new Function(...Object.keys(g), src)(...Object.values(g));
    const click = (target, pageX, pageY) => on.click.forEach((f) => f({ target, pageX, pageY }));
    return { sent, on, click };
  };
  const t = run();
  const button = { tagName: 'BUTTON', innerText: '  Get\n started ', getAttribute: () => null, matches: () => false, closest: (s) => (s.includes('button') ? button : null) };
  const field = { tagName: 'INPUT', type: 'email', innerText: '', getAttribute: () => null, matches: (s) => s.includes('input'), closest: (s) => (s.includes('input') ? field : null) };
  const div = { tagName: 'DIV', closest: () => null };
  t.click(button, 500, 120.6);
  t.click(field, 250, 300);
  t.click(div, 999, 2000);
  expect(t.sent).toHaveLength(1); // only the pageview so far
  t.on.pagehide.forEach((f) => f());
  const b = t.sent[1];
  expect([b.e, b.d, b.p, b.v]).toEqual(['clicks', 'x.flisk.si', '/', 'mobile']);
  expect(b.c).toEqual([{ x: 0.5, y: 121, k: 'ctl', t: 'Get started' }, { x: 0.25, y: 300, k: 'ctl', t: 'email' }, { x: 0.999, y: 2000, k: 'dead', t: 'div' }]);
  t.on.pagehide.forEach((f) => f());
  expect(t.sent).toHaveLength(2); // nothing queued, nothing sent
  for (let i = 0; i < 20; i++) t.click(div, 1, 1);
  expect(t.sent).toHaveLength(3); // a full batch of 20 goes at once
  for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    const q = run(nav);
    expect(q.on.click || []).toHaveLength(1); // the outbound-link listener only
    q.click(div, 1, 1); q.on.pagehide?.forEach((f) => f());
    expect(q.sent).toHaveLength(1);
  }
  // The heatmap's preview frame (#flisk-preview) is not a visit: no pageview, no click listener.
  const p = run({}, { hash: '#flisk-preview' });
  expect(p.sent).toHaveLength(0);
  expect(p.on.click).toBeUndefined();
});
