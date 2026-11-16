import { expect, test } from 'bun:test';
import { handle } from '../src/index.js';
import { withSecurityHeaders } from '../src/security-headers.js';
import { beacon, fakeEnv } from './helpers.js';

const BASELINE = {
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const expectBaseline = (res) => {
  for (const [k, v] of Object.entries(BASELINE)) expect(res.headers.get(k)).toBe(v);
  expect(res.headers.get('referrer-policy')).toBeTruthy();
};

test('dashboard HTML is not frameable by other sites', async () => {
  const res = await handle(new Request('https://analytics.flisk.si/'), fakeEnv());
  expect(res.headers.get('content-type')).toContain('text/html');
  expectBaseline(res);
  expect(res.headers.get('x-frame-options')).toBeTruthy();
  expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors '(none|self)'/);
});

test('JSON, text and redirect responses get the baseline but no framing headers', async () => {
  const env = fakeEnv();
  for (const path of ['/health', '/api/sites', '/robots.txt']) {
    const res = await handle(new Request(`https://analytics.flisk.si${path}`), env);
    expectBaseline(res);
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBeNull();
  }
  const login = await handle(new Request('https://analytics.flisk.si/auth/login'), env);
  expect(login.status).toBe(303);
  expectBaseline(login);
});

test('the collect endpoint keeps its CORS headers and stays embeddable', async () => {
  const res = await handle(beacon({ d: 'flisk.sh', u: 'https://flisk.sh/' }), fakeEnv());
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expectBaseline(res);
  expect(res.headers.get('x-frame-options')).toBeNull();
  const preflight = await handle(new Request('https://analytics.flisk.si/e', { method: 'OPTIONS' }), fakeEnv());
  expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  expect(preflight.headers.get('x-frame-options')).toBeNull();
});

test('withSecurityHeaders fills only what is missing', () => {
  const bare = withSecurityHeaders(new Response('<p>x</p>', { headers: { 'content-type': 'text/html' } }));
  expect(bare.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(bare.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
  const own = withSecurityHeaders(new Response('x', { headers: { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'" } }));
  expect(own.headers.get('x-frame-options')).toBe('DENY');
  expect(own.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'self'");
  expect(withSecurityHeaders(Response.redirect('https://example.com')).headers.get('x-content-type-options')).toBe('nosniff');
});
