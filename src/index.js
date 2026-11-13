import { allowed, githubAuthorizeUrl, githubLogin } from './auth.js';
import { clearSession, makeSession, readSession, sameOrigin } from './session.js';
import { CORS, handleBeacon } from './ingest.js';
import { DEFAULT_PANELS, siteStats, sitesOverview, validDomain } from './stats.js';
import { dashboardPage, installPage, loginPage, messagePage, newSitePage, sitesPage } from './ui.js';

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY } });
const redirect = (location, cookie) => { const h = new Headers({ location }); if (cookie) for (const c of [].concat(cookie)) h.append('set-cookie', c); return new Response(null, { status: 303, headers: h }); };

const STATE = 'fa_state';
const cookieOf = (request, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get('cookie') || '')?.[1] || '';

export function cleanDomain(input) {
  let d = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return validDomain(d) ? d : '';
}

async function ownerOf(env, domain) {
  const row = await env.DB.prepare('SELECT owner FROM sites WHERE domain = ?').bind(domain).first();
  return row?.owner || '';
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // The beacon first: it is the hot path and needs no session.
  if (path === '/e') {
    if (method === 'POST' || method === 'OPTIONS') return handleBeacon(request, env);
    return new Response(null, { status: 405, headers: CORS });
  }
  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });

  if (path === '/auth/login') {
    const state = crypto.randomUUID();
    return redirect(githubAuthorizeUrl(env, state), `${STATE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  }
  if (path === '/auth/callback') {
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!code || !state || state !== cookieOf(request, STATE)) return html(loginPage('Sign-in expired. Try again.'), 400);
    const login = await githubLogin(env, code).catch(() => null);
    if (!login) return html(loginPage('GitHub did not sign you in. Try again.'), 400);
    if (!allowed(env, login)) return html(loginPage(`${login} is not on the list yet.`), 403);
    return redirect('/', [await makeSession(env, login), `${STATE}=; Path=/; Max-Age=0`]);
  }
  if (path === '/logout' && method === 'POST') {
    if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return html(messagePage('Not allowed', 'Sign out from the cabinet.'), 403);
    return redirect('/', clearSession());
  }

  const session = await readSession(env, request);
  const isApi = path.startsWith('/api/');
  if (!session || !allowed(env, session.login)) return isApi ? json(401, { error: 'sign in' }) : html(loginPage());
  const login = session.login;

  if (path === '/' && method === 'GET') return html(sitesPage(login));
  if (path === '/new' && method === 'GET') return html(newSitePage(login));
  if (path === '/sites' && method === 'POST') {
    if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return html(messagePage('Not allowed', 'Add sites from the cabinet.', login), 403);
    const domain = cleanDomain((await request.formData().catch(() => null))?.get('domain'));
    if (!domain) return html(newSitePage(login, 'That is not a domain. Use something like flisk.sh.'), 400);
    const owner = await ownerOf(env, domain);
    if (owner && owner !== login) return html(newSitePage(login, 'That site belongs to someone else.'), 409);
    if (!owner) await env.DB.prepare('INSERT INTO sites (domain, owner, created) VALUES (?, ?, ?)').bind(domain, login, Date.now()).run();
    return redirect(`/site/${domain}/install`);
  }

  const m = /^\/site\/([^/]+)(\/install)?$/.exec(path);
  if (m && method === 'GET') {
    const domain = decodeURIComponent(m[1]);
    if (!validDomain(domain) || (await ownerOf(env, domain)) !== login) return html(messagePage('Site not found', 'It is not in your list.', login), 404);
    return html(m[2] ? installPage(login, domain) : dashboardPage(login, domain));
  }

  if (path === '/api/sites' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT domain FROM sites WHERE owner = ? ORDER BY created').bind(login).all();
    const domains = (results || []).map((r) => r.domain);
    try {
      return json(200, { sites: await sitesOverview(env, domains) });
    } catch {
      return json(200, { sites: domains.map((domain) => ({ domain, total: 0, previous: 0, change: null, days: Array(30).fill(0) })), note: 'stats unavailable' });
    }
  }
  if (path === '/api/stats' && method === 'GET') {
    const site = url.searchParams.get('site') || '';
    if (!validDomain(site) || (await ownerOf(env, site)) !== login) return json(404, { error: 'site not found' });
    const parts = (url.searchParams.get('parts') ?? DEFAULT_PANELS.join(',')).split(',').filter(Boolean);
    try {
      const out = await siteStats(env, site, url.searchParams.get('range') || '30d', parts);
      return out ? json(200, out) : json(400, { error: 'bad range' });
    } catch {
      return json(502, { error: 'stats unavailable' });
    }
  }
  return html(messagePage('Not found', 'There is nothing at this address.', login), 404);
}

export default { fetch: (request, env) => handle(request, env) };
