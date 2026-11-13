// API keys for agents: `fa_` plus 32 hex characters. Only a SHA-256 of the key is stored, so a key can be shown once and never again.
import { allowed } from './auth.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function createToken(env, login, label, now = Date.now()) {
  const raw = `fa_${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
  const name = String(label || '').trim().slice(0, 40) || 'agent';
  await env.DB.prepare('INSERT INTO tokens (hash, owner, label, created) VALUES (?, ?, ?, ?)').bind(await sha(raw), login, name, now).run();
  return { token: raw, label: name };
}

// The login behind `Authorization: Bearer fa_...`, or ''.
export async function bearerLogin(env, request) {
  const m = /^Bearer (fa_[a-f0-9]{32})$/.exec(request.headers.get('authorization') || '');
  if (!m) return '';
  const row = await env.DB.prepare('SELECT owner FROM tokens WHERE hash = ?').bind(await sha(m[1])).first();
  return row?.owner && allowed(env, row.owner) ? row.owner : '';
}

export async function listTokens(env, login) {
  const { results } = await env.DB.prepare('SELECT hash, label, created FROM tokens WHERE owner = ? ORDER BY created DESC').bind(login).all();
  return (results || []).map((r) => ({ id: r.hash.slice(0, 12), label: r.label, created: r.created }));
}

export async function revokeToken(env, login, id) {
  if (!/^[a-f0-9]{12}$/.test(id)) return;
  await env.DB.prepare('DELETE FROM tokens WHERE owner = ? AND substr(hash, 1, 12) = ?').bind(login, id).run();
}
