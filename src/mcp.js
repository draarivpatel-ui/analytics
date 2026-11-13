// A small MCP server (JSON-RPC over HTTP POST, no sessions) so an agent can add a site, get the install steps and read the numbers.
import { DEFAULT_PANELS, PANELS, RANGES, siteStats, sitesOverview, validDomain } from './stats.js';
import { addSite, listDomains, ownerOf } from './sites.js';
import { snippets } from './ui.js';

const PANEL_NAMES = Object.keys(PANELS);
const TOOLS = [
  { name: 'list_sites', description: 'List your websites with visitors in the last 30 days.', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_site', description: 'Register a website (domain only, like flisk.sh) and get the install snippets. Safe to call again.', inputSchema: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] } },
  { name: 'install_snippet', description: 'The script tag and the one-command Jekyll installer for a site you already added.', inputSchema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'] } },
  { name: 'site_stats', description: 'Visitors, visits, pageviews, bounce rate, duration and the top lists for one site.', inputSchema: { type: 'object', properties: { site: { type: 'string' }, range: { type: 'string', enum: Object.keys(RANGES), default: '30d' }, panels: { type: 'array', items: { type: 'string', enum: PANEL_NAMES }, description: `Default: ${DEFAULT_PANELS.join(', ')}` } }, required: ['site'] } },
];

const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

async function mine(env, login, site) {
  if (!validDomain(site) || (await ownerOf(env, site)) !== login) throw new Error(`${site} is not in your list. Call add_site first.`);
}

async function call(env, login, name, args = {}) {
  if (name === 'list_sites') {
    const domains = await listDomains(env, login);
    try { return text({ sites: await sitesOverview(env, domains) }); } catch { return text({ sites: domains.map((domain) => ({ domain })), note: 'stats unavailable' }); }
  }
  if (name === 'add_site') {
    const r = await addSite(env, login, args.domain);
    return r.error ? text(r.error, true) : text({ domain: r.domain, created: r.created, install: snippets(r.domain) });
  }
  if (name === 'install_snippet') { await mine(env, login, args.site); return text(snippets(args.site)); }
  if (name === 'site_stats') {
    await mine(env, login, args.site);
    const out = await siteStats(env, args.site, args.range || '30d', args.panels || DEFAULT_PANELS);
    return out ? text(out) : text('Unknown range. Use today, 7d, 30d or 12m.', true);
  }
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function mcpResponse(request, env, login) {
  const send = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  let msg;
  try { msg = JSON.parse(await request.text()); } catch { return send(fail(null, -32700, 'Parse error'), 400); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return send(fail(msg?.id ?? null, -32600, 'Invalid request'), 400);
  if (msg.id === undefined) return new Response(null, { status: 202 }); // a notification
  if (msg.method === 'initialize') return send(reply(msg.id, { protocolVersion: msg.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'flisk-analytics', version: '1.0.0' } }));
  if (msg.method === 'ping') return send(reply(msg.id, {}));
  if (msg.method === 'tools/list') return send(reply(msg.id, { tools: TOOLS }));
  if (msg.method === 'tools/call') {
    try { return send(reply(msg.id, await call(env, login, msg.params?.name, msg.params?.arguments))); } catch (e) {
      return e.code ? send(fail(msg.id, e.code, e.message)) : send(reply(msg.id, text(e.message || 'failed', true)));
    }
  }
  return send(fail(msg.id, -32601, 'Method not found'));
}
