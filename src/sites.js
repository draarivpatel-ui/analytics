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

// Adding a site you already own is fine and changes nothing. Someone else's site is refused,
// so a stranger cannot register (and read the stats of) a domain that is already taken.
//
// The claim is one atomic statement: the row is written only when the domain is free, so two
// accounts racing to add the same domain cannot both win, and there is no read-then-write gap
// where a PK clash would surface as a 500. ON CONFLICT leaves an existing row untouched.
export async function addSite(env, login, input) {
  const domain = cleanDomain(input);
  if (!domain) return { error: 'That is not a domain. Use something like flisk.sh.', status: 400 };
  const res = await env.DB
    .prepare('INSERT INTO sites (domain, owner, created) VALUES (?, ?, ?) ON CONFLICT(domain) DO NOTHING')
    .bind(domain, login, Date.now()).run();
  if ((res?.meta?.changes ?? 0) > 0) return { domain, created: true };
  // The domain already existed: it is yours (a no-op) or someone else's (refused).
  const owner = await ownerOf(env, domain);
  if (owner && owner !== login) return { error: 'That site belongs to someone else.', status: 409 };
  return { domain, created: false };
}
