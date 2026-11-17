import { beforeEach, expect, test } from 'bun:test';
import { classifySource, cleanLink, handleBeacon, isBot, parseUa, resetSitesCache, underCap, visitorHash } from '../src/ingest.js';
import { beacon, fakeCache, fakeEnv, UA } from './helpers.js';

beforeEach(() => resetSitesCache());

test('a real pageview writes exactly one data point with the documented blobs', async () => {
  const env = fakeEnv();
  const res = await handleBeacon(beacon({ d: 'flisk.sh', p: '/docs/quickstart/?x=1#top', r: 'https://github.com/flisk-sh/flisk', s: 'abc', u: 'launch', t: 'ivory' }), env);
  expect(res.status).toBe(204);
  expect(env.points).toHaveLength(1);
  const p = env.points[0];
  expect(p.indexes).toEqual(['flisk.sh']);
  expect(p.doubles).toEqual([1]);
  expect(p.blobs[0]).toBe('/docs/quickstart/'); // query and hash dropped
  expect(p.blobs.slice(1, 4)).toEqual(['GitHub', 'Referral', '']);
  expect(p.blobs[4]).toBe('Chrome');
  expect(p.blobs[5]).toBe('macOS');
  expect(p.blobs[6]).toBe('Desktop');
  expect(p.blobs[7]).toMatch(/^[0-9a-f]{16}$/);
  expect(p.blobs[8]).toBe('abc');
  expect(p.blobs[9]).toBe('launch');
  expect(p.blobs[12]).toBe('ivory');
  expect(JSON.stringify(p)).not.toContain('203.0.113.9'); // the IP is never stored
});

test('bots, unknown sites, bad origins and junk write nothing', async () => {
  const env = fakeEnv();
  for (const req of [
    beacon({ d: 'flisk.sh', p: '/' }, { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1)' }),
    beacon({ d: 'flisk.sh', p: '/' }, { 'user-agent': '' }),
    beacon({ d: 'evil.example', p: '/' }),
    beacon({ d: 'flisk.sh', p: '/' }, { origin: 'https://evil.example' }),
    beacon('not json'),
    beacon({ p: '/' }),
  ]) expect((await handleBeacon(req, env)).status).toBe(204);
  expect(env.points).toHaveLength(0);
});

test('www and subdomain origins are accepted for the registered domain', async () => {
  const env = fakeEnv();
  await handleBeacon(beacon({ d: 'www.flisk.sh', p: '/' }, { origin: 'https://www.flisk.sh' }), env);
  await handleBeacon(beacon({ d: 'flisk.sh', p: '/' }, { origin: 'https://docs.flisk.sh' }), env);
  expect(env.points).toHaveLength(2);
});

test('the daily cap stops writes and never throws', async () => {
  const cache = fakeCache();
  const env = fakeEnv({ DAILY_CAP: '3' });
  const now = Date.UTC(2026, 10, 13, 12);
  const got = [];
  for (let i = 0; i < 5; i++) got.push(await underCap(env, now, cache));
  expect(got).toEqual([true, true, true, false, false]);
  expect(await underCap(env, now + 86400e3, cache)).toBe(true); // a new day starts again
});

test('the visitor hash changes by day and by site and hides the inputs', async () => {
  const env = fakeEnv();
  const a = await visitorHash(env, 'flisk.sh', '1.2.3.4', UA, new Date('2026-11-13T10:00:00Z'));
  expect(a).toBe(await visitorHash(env, 'flisk.sh', '1.2.3.4', UA, new Date('2026-11-13T23:00:00Z')));
  expect(a).not.toBe(await visitorHash(env, 'flisk.sh', '1.2.3.4', UA, new Date('2026-11-14T00:00:01Z')));
  expect(a).not.toBe(await visitorHash(env, 'chat.flisk.si', '1.2.3.4', UA, new Date('2026-11-13T10:00:00Z')));
});

test('referrers become the sources the dashboard shows', () => {
  expect(classifySource('', 'flisk.sh')).toEqual({ source: 'Direct / None', channel: 'Direct' });
  expect(classifySource('https://flisk.sh/layers/', 'flisk.sh').channel).toBe('Direct');
  expect(classifySource('https://t.co/abc', 'flisk.sh')).toEqual({ source: 'X (Twitter)', channel: 'Social' });
  expect(classifySource('https://news.ycombinator.com/item?id=1', 'flisk.sh').source).toBe('Hacker News');
  expect(classifySource('https://www.google.com/', 'flisk.sh')).toEqual({ source: 'Google', channel: 'Organic Search' });
  expect(classifySource('https://blog.example.org/post', 'flisk.sh')).toEqual({ source: 'blog.example.org', channel: 'Referral' });
});

test('user agents', () => {
  expect(parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS', device: 'Mobile' });
  expect(parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130')).toEqual({ browser: 'Edge', os: 'Windows', device: 'Desktop' });
  expect(isBot('Googlebot/2.1')).toBe(true);
  expect(isBot(UA)).toBe(false);
});

test('the theme is validated: junk, upper case and long ids are cleaned, and an old tracker without t stores an empty theme', async () => {
  const { cleanTheme } = await import('../src/ingest.js');
  expect(cleanTheme(' Cool-Glow ')).toBe('cool-glow');
  expect(cleanTheme('a'.repeat(33))).toBe('');
  expect(cleanTheme('<script>')).toBe('');
  expect(cleanTheme({})).toBe('');
  expect(cleanTheme(undefined)).toBe('');
  const env = fakeEnv();
  await handleBeacon(beacon({ d: 'flisk.sh', p: '/' }), env);
  await handleBeacon(beacon({ d: 'flisk.sh', p: '/', t: 'x y' }), env);
  expect(env.points.map((p) => p.blobs[12])).toEqual(['', '']);
});

test('a.js sends the theme: data-flisk-theme, else data-theme, never light or dark, cleaned', async () => {
  const src = await Bun.file(new URL('../public/a.js', import.meta.url)).text();
  const run = (attrs) => {
    let sent;
    const html = { getAttribute: (k) => attrs[k] ?? null };
    const script = { getAttribute: (k) => (k === 'data-domain' ? 'x.flisk.si' : null) };
    const g = { document: { currentScript: script, documentElement: html, referrer: '', visibilityState: 'visible' }, navigator: { userAgent: 'Chrome', sendBeacon: (_u, b) => { sent = JSON.parse(b); return true; } }, location: { pathname: '/', search: '' }, history: {}, sessionStorage: { getItem: () => 'sid', setItem() {} }, addEventListener() {}, URLSearchParams, setTimeout, JSON, String, Math, RegExp };
    new Function(...Object.keys(g), src)(...Object.values(g));
    return sent.t;
  };
  expect(run({ 'data-flisk-theme': 'ivory' })).toBe('ivory');
  expect(run({ 'data-flisk-theme': 'ivory', 'data-theme': 'dark' })).toBe('ivory');
  expect(run({ 'data-theme': 'glow' })).toBe('glow');
  expect(run({ 'data-theme': 'dark' })).toBe('');
  expect(run({ 'data-theme': ' Light ' })).toBe('');
  expect(run({})).toBe('');
  expect(run({ 'data-flisk-theme': ' Cool Glow! ' })).toBe('coolglow');
  expect(run({ 'data-flisk-theme': 'a'.repeat(40) })).toHaveLength(32);
});

test('a link click writes one data point with kind click and a cleaned target; junk targets write nothing', async () => {
  const env = fakeEnv();
  const ok = await handleBeacon(beacon({ d: 'flisk.sh', p: '/docs/', e: 'click', l: 'https://x.com/flisk_sh/?a=1#b', s: 'abc' }), env);
  expect(ok.status).toBe(204);
  expect(env.points).toHaveLength(1);
  expect(env.points[0].blobs[13]).toBe('click');
  expect(env.points[0].blobs[14]).toBe('x.com/flisk_sh');
  for (const l of ['', 'javascript:alert(1)', 'mailto:a@b.c']) await handleBeacon(beacon({ d: 'flisk.sh', p: '/', e: 'click', l }), env);
  expect(env.points).toHaveLength(1);
  const pv = fakeEnv();
  await handleBeacon(beacon({ d: 'flisk.sh', p: '/' }), pv);
  expect(pv.points[0].blobs[13]).toBe('');
  expect(cleanLink('https://a.b/' + 'x'.repeat(300)).length).toBeLessThanOrEqual(120);
});
