import { beforeEach, expect, test } from 'bun:test';
import { handle } from '../src/index.js';
import { resetSitesCache } from '../src/ingest.js';
import { makeSession } from '../src/session.js';
import { createToken, sha } from '../src/tokens.js';
import { fakeEnv } from './helpers.js';

beforeEach(() => resetSitesCache());
const rpc = (env, key, body) => handle(new Request('https://analytics.flisk.si/mcp', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
const call = async (env, key, name, args) => (await (await rpc(env, key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()).result;

test('a key is stored as a hash only, and works as a Bearer', async () => {
  const env = fakeEnv();
  const { token } = await createToken(env, 'odykyi', 'claude-code');
  expect(token).toMatch(/^fa_[a-f0-9]{32}$/);
  expect(env.tokens.has(token)).toBe(false);
  expect(env.tokens.has(await sha(token))).toBe(true);
  expect((await rpc(env, token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
});

test('/mcp refuses no key, a wrong key and a key of someone off the list', async () => {
  const env = fakeEnv();
  expect((await handle(new Request('https://analytics.flisk.si/mcp', { method: 'POST', body: '{}' }), env)).status).toBe(401);
  expect((await rpc(env, `fa_${'0'.repeat(32)}`, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  const { token } = await createToken(env, 'someone', 'x');
  expect((await rpc(env, token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
});

test('initialize and tools/list describe the four tools', async () => {
  const env = fakeEnv();
  const { token } = await createToken(env, 'odykyi', 'a');
  const init = await (await rpc(env, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json();
  expect(init.result.serverInfo.name).toBe('flisk-analytics');
  const list = await (await rpc(env, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  expect(list.result.tools.map((t) => t.name)).toEqual(['list_sites', 'add_site', 'install_snippet', 'site_stats']);
  expect((await rpc(env, token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
});

test('an agent adds a site and gets the install steps', async () => {
  const env = fakeEnv();
  const { token } = await createToken(env, 'odykyi', 'a');
  const added = await call(env, token, 'add_site', { domain: 'https://Fleet.flisk.si/' });
  expect(env.sites.get('fleet.flisk.si')).toBe('odykyi');
  expect(JSON.stringify(added)).toContain('fleet.flisk.si');
  const snip = await call(env, token, 'install_snippet', { site: 'fleet.flisk.si' });
  expect(snip.content[0].text).toContain('data-domain=\\"fleet.flisk.si\\"');
  expect(snip.content[0].text).toContain('install/jekyll | sh -s -- fleet.flisk.si');
  const bad = await call(env, token, 'add_site', { domain: 'not a domain' });
  expect(bad.isError).toBe(true);
});

test('an agent cannot read a site that belongs to someone else', async () => {
  const env = fakeEnv();
  env.sites.set('theirs.example', 'other');
  const { token } = await createToken(env, 'odykyi', 'a');
  const r = await call(env, token, 'install_snippet', { site: 'theirs.example' });
  expect(r.isError).toBe(true);
});

test('a stranger cannot claim a site that is already registered, and the owner keeps it', async () => {
  const env = fakeEnv();
  env.sites.set('mine.flisk.si', 'odykyi');
  env.ALLOWED_LOGINS = 'odykyi,intruder';
  const { token } = await createToken(env, 'intruder', 'a');
  const r = await call(env, token, 'add_site', { domain: 'https://MINE.flisk.si/' });
  expect(r.isError).toBe(true);
  expect(JSON.stringify(r)).toContain('belongs to someone else');
  // The owner is unchanged: the stranger did not overwrite it.
  expect(env.sites.get('mine.flisk.si')).toBe('odykyi');
});

test('re-adding your own site is a no-op, not a new claim', async () => {
  const env = fakeEnv();
  env.sites.set('fleet.flisk.si', 'odykyi');
  const { token } = await createToken(env, 'odykyi', 'a');
  const r = await call(env, token, 'add_site', { domain: 'fleet.flisk.si' });
  expect(r.isError).toBeUndefined();
  expect(env.sites.get('fleet.flisk.si')).toBe('odykyi');
});

test('the same key opens /api/sites, and a cabinet user can make and revoke keys', async () => {
  const env = fakeEnv();
  const { token } = await createToken(env, 'odykyi', 'a');
  const res = await handle(new Request('https://analytics.flisk.si/api/sites', { headers: { authorization: `Bearer ${token}` } }), env);
  expect(res.status).toBe(200);
  const cookie = (await makeSession(env, 'odykyi')).split(';')[0];
  const h = { cookie, origin: 'https://analytics.flisk.si' };
  const made = await handle(new Request('https://analytics.flisk.si/tokens', { method: 'POST', headers: h, body: new URLSearchParams({ label: 'ci' }) }), env);
  const html = await made.text();
  expect(html).toMatch(/fa_[a-f0-9]{32}/);
  const id = [...env.tokens.keys()].find((k) => env.tokens.get(k).label === 'ci').slice(0, 12);
  await handle(new Request('https://analytics.flisk.si/tokens', { method: 'POST', headers: h, body: new URLSearchParams({ revoke: id }) }), env);
  expect([...env.tokens.values()].some((t) => t.label === 'ci')).toBe(false);
  const list = await (await handle(new Request('https://analytics.flisk.si/tokens', { headers: h }), env)).text();
  expect(list).not.toMatch(/fa_[a-f0-9]{32}/);
});
