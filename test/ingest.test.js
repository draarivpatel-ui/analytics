import { beforeEach, expect, test } from 'bun:test';
import { classifySource, handleBeacon, isBot, parseUa, resetSitesCache, underCap, visitorHash } from '../src/ingest.js';
import { beacon, fakeCache, fakeEnv, UA } from './helpers.js';

beforeEach(() => resetSitesCache());

test('a real pageview writes exactly one data point with the documented blobs', async () => {
  const env = fakeEnv();
  const res = await handleBeacon(beacon({ d: 'flisk.sh', p: '/docs/quickstart/?x=1#top', r: 'https://github.com/flisk-sh/flisk', s: 'abc', u: 'launch' }), env);
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
