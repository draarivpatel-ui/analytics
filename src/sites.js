// Site records in D1, shared by the cabinet and the agent API.
import { validDomain } from './stats.js';

export function cleanDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return validDomain(d) ? d : '';
}

export async function ownerOf(env, domain) {
  const row = await env.DB.prepare('SELECT owner FROM sites WHERE domain = ?').bind(domain).first();
  return row?.owner || '';
}

export async function listDomains(env, login) {
  const { results } = await env.DB.prepare('SELECT domain FROM sites WHERE owner = ? ORDER BY created').bind(login).all();
  return (results || []).map((r) => r.domain);
}

// Adding a site you already own is fine and changes nothing. Someone else's site is refused.
export async function addSite(env, login, input) {
  const domain = cleanDomain(input);
  if (!domain) return { error: 'That is not a domain. Use something like flisk.sh.', status: 400 };
  const owner = await ownerOf(env, domain);
  if (owner && owner !== login) return { error: 'That site belongs to someone else.', status: 409 };
  if (!owner) await env.DB.prepare('INSERT INTO sites (domain, owner, created) VALUES (?, ?, ?)').bind(domain, login, Date.now()).run();
  return { domain, created: !owner };
}
