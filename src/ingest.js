// The pageview beacon: one request in, one Analytics Engine data point out. Nothing else is stored.
// Click-map batches ({ e: 'clicks' }) go to D1 instead (src/clicks.js).
// No cookie, no IP kept. A visitor is a hash of (secret, day, site, ip, user agent) that changes every day.

export const BLOBS = ['path', 'source', 'channel', 'country', 'browser', 'os', 'device', 'visitor', 'sid', 'campaign', 'region', 'city', 'theme', 'kind', 'target', 'language', 'utm_source', 'utm_medium'];
// New blobs only ever go at the END: old data points keep their column numbers (see PANELS in src/stats.js).

import { recordClicks } from './clicks.js';

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|node-fetch|axios|go-http|java\/|monitor|uptime|pingdom|phantom|puppeteer|playwright/i;
export const isBot = (ua) => !ua || BOT.test(ua);

export function parseUa(ua = '') {
  const browser = /\bEdg(?:A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux|X11/.test(ua) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobi|iPhone|Android/.test(ua) ? 'Mobile' : 'Desktop';
  return { browser, os, device };
}

const SOCIAL = { 'x.com': 'X (Twitter)', 't.co': 'X (Twitter)', 'twitter.com': 'X (Twitter)', 'reddit.com': 'Reddit', 'old.reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn', 'lnkd.in': 'LinkedIn', 'facebook.com': 'Facebook', 'youtube.com': 'YouTube', 'news.ycombinator.com': 'Hacker News', 'bsky.app': 'Bluesky', 'discord.com': 'Discord' };
const SEARCH = [/^(www\.)?google\./, /^(www\.)?bing\.com$/, /^duckduckgo\.com$/, /^(www\.)?ecosia\.org$/, /^search\.brave\.com$/, /^(www\.)?baidu\.com$/, /^yandex\./];

// "Direct / None", a social site, a search engine, or any other referring host.
export function classifySource(referrer, siteHost) {
  let host = '';
  try { host = new URL(referrer).hostname.replace(/^www\./, ''); } catch { /* none */ }
  if (!host || host === siteHost || host.endsWith(`.${siteHost}`)) return { source: 'Direct / None', channel: 'Direct' };
  if (SOCIAL[host]) return { source: SOCIAL[host], channel: 'Social' };
  if (host === 'github.com') return { source: 'GitHub', channel: 'Referral' };
  if (SEARCH.some((re) => re.test(host))) return { source: host.startsWith('google') || /^www\.google\./.test(host) ? 'Google' : host, channel: 'Organic Search' };
  return { source: host, channel: 'Referral' };
}

// A utm value (campaign, source, medium): lowercase, stops at the first ? or #, spaces become dashes, only [a-z0-9._-] stay, 60 characters.
export function cleanUtm(v) {
  const s = String(v ?? '').trim().split(/[?#]/)[0].toLowerCase().replace(/[\s+]+/g, '-').replace(/[^a-z0-9._-]/g, '');
  return s.slice(0, 60);
}
export const cleanCampaign = cleanUtm;

// utm_source values we know by name. The rest show as the cleaned value.
const UTM_SOURCES = {
  x: 'X (Twitter)', 'x.com': 'X (Twitter)', twitter: 'X (Twitter)', 'twitter.com': 'X (Twitter)', 't.co': 'X (Twitter)',
  reddit: 'Reddit', hn: 'Hacker News', hackernews: 'Hacker News', 'hacker-news': 'Hacker News', 'news.ycombinator.com': 'Hacker News',
  linkedin: 'LinkedIn', 'dev.to': 'dev.to', devto: 'dev.to', toolradar: 'Toolradar', producthunt: 'Product Hunt', 'product-hunt': 'Product Hunt',
  github: 'GitHub', facebook: 'Facebook', fb: 'Facebook', youtube: 'YouTube', bluesky: 'Bluesky', bsky: 'Bluesky', discord: 'Discord',
  telegram: 'Telegram', mastodon: 'Mastodon', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', newsletter: 'Newsletter',
};
const SOCIAL_NAMES = new Set(['X (Twitter)', 'Reddit', 'Hacker News', 'LinkedIn', 'Facebook', 'YouTube', 'Bluesky', 'Discord', 'Telegram', 'Mastodon', 'Product Hunt', 'dev.to']);
// utm_medium values: the Channel shown. Unknown ones are shown capitalised as sent.
const UTM_MEDIA = {
  social: 'Social', 'social-media': 'Social', cta: 'CTA', email: 'Email', 'e-mail': 'Email', newsletter: 'Email',
  cpc: 'Paid', ppc: 'Paid', paid: 'Paid', paidsocial: 'Paid', 'paid-social': 'Paid', display: 'Paid', banner: 'Paid',
  referral: 'Referral', organic: 'Organic Search', affiliate: 'Referral',
};

// utm_source (if any) names the Source and utm_medium the Channel; with no utm_source the referrer decides (classifySource).
export function classifyVisit(b, siteHost) {
  const us = cleanUtm(b?.us), um = cleanUtm(b?.um);
  const ref = classifySource(b?.r, siteHost);
  if (!us) return { ...ref, us: '', um };
  const source = UTM_SOURCES[us] || us;
  const channel = UTM_MEDIA[um] || (um ? um[0].toUpperCase() + um.slice(1) : SOCIAL_NAMES.has(source) ? 'Social' : ref.channel === 'Direct' ? 'Referral' : ref.channel);
  return { source, channel, us, um };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function visitorHash(env, site, ip, ua, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.HASH_SECRET || ''}|${day}|${site}|${ip}|${ua}`));
  return hex(buf).slice(0, 16);
}

const names = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code) => { try { return (code && names?.of(code)) || ''; } catch { return ''; } };

const clip = (v, n = 120) => String(v ?? '').slice(0, n);
// A theme id such as ivory or cool-glow: lowercase letters, digits and dashes, 32 characters at most. Anything else is dropped.
export const cleanTheme = (t) => { const s = String(t ?? '').trim().toLowerCase(); return /^[a-z0-9-]{1,32}$/.test(s) ? s : ''; };
// An outbound or download link: host and path only, no query, no hash. Anything that is not http(s) is dropped.
export function cleanLink(l) {
  if (/^(javascript|mailto|tel|sms|data|file|ftp|blob):/i.test(String(l ?? '').trim())) return '';
  try { const u = new URL(String(l ?? '').includes('://') ? String(l) : `https://${l}`); return /^https?:$/.test(u.protocol) && u.host ? clip(u.host + u.pathname.replace(/\/$/, ''), 120) : ''; } catch { return ''; }
}
// The visitor's browser language from Accept-Language: the primary subtag of the first tag only ("nl-NL,en;q=0.8" -> "nl").
// No region, no list of preferences, nothing that tells one visitor from another.
export function primaryLanguage(header) {
  const m = /^\s*([a-z]{2,3})(?:[-_][a-z0-9]+)*\s*(?:[;,]|$)/i.exec(String(header ?? ''));
  return m ? m[1].toLowerCase() : '';
}
const cleanPath = (p) => { const s = clip(p, 200); return s.startsWith('/') ? s.split('?')[0].split('#')[0] || '/' : '/'; };

// Registered domains, read from D1 at most once a minute per isolate. A beacon for any other domain is dropped.
let sitesAt = 0;
let sitesSet = new Set();
export function resetSitesCache() { sitesAt = 0; sitesSet = new Set(); }
export async function knownSites(env, now = Date.now()) {
  if (now - sitesAt < 60_000 && sitesAt) return sitesSet;
  try {
    const { results } = await env.DB.prepare('SELECT domain FROM sites').all();
    sitesSet = new Set((results || []).map((r) => r.domain));
    sitesAt = now;
  } catch { /* keep the last list */ }
  return sitesSet;
}

// An approximate daily cap per data centre, kept in the free Cache API: a read and a write, no billed storage.
export async function underCap(env, now = Date.now(), cache = globalThis.caches?.default) {
  const cap = Number(env.DAILY_CAP) || 30000;
  if (!cache) return true;
  const key = new Request(`https://cap.invalid/${new Date(now).toISOString().slice(0, 10)}`);
  const n = Number(await (await cache.match(key))?.text().catch(() => 0)) || 0;
  if (n >= cap) return false;
  await cache.put(key, new Response(String(n + 1), { headers: { 'cache-control': 'max-age=86400' } })).catch(() => {});
  return true;
}

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const done = () => new Response(null, { status: 204, headers: CORS });

export async function handleBeacon(request, env, now = Date.now()) {
  if (request.method === 'OPTIONS') return done();
  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return done();
  let b;
  try { b = JSON.parse(await request.text()); } catch { return done(); }
  const site = clip(b?.d, 100).toLowerCase().replace(/^www\./, '');
  if (!site || !(await knownSites(env, now)).has(site)) return done();
  let originHost = '';
  try { originHost = new URL(request.headers.get('origin') || '').hostname.replace(/^www\./, ''); } catch { /* none */ }
  if (originHost && originHost !== site && !originHost.endsWith(`.${site}`)) return done();
  // Click-map batches: D1 with its own daily cap, not Analytics Engine. Do Not Track and Global Privacy Control are honoured here too.
  if (b.e === 'clicks') {
    if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return done();
    await recordClicks(env, site, b, now).catch(() => 0);
    return done();
  }
  if (!(await underCap(env, now))) return done();
  const click = b.e === 'click';
  const target = click ? cleanLink(b.l) : '';
  if (click && !target) return done();
  const { source, channel, us, um } = classifyVisit(b, site);
  const { browser, os, device } = parseUa(ua);
  const cf = request.cf || {};
  const ip = request.headers.get('cf-connecting-ip') || '';
  const blobs = [cleanPath(b.p), clip(source), channel, countryName(cf.country), browser, os, device, await visitorHash(env, site, ip, ua, new Date(now)), clip(b.s, 24), cleanCampaign(b.u), clip(cf.region, 60), clip(cf.city, 60), cleanTheme(b.t), click ? 'click' : '', target, click ? '' : primaryLanguage(request.headers.get('accept-language')), us, um];
  env.EVENTS.writeDataPoint({ indexes: [site], blobs, doubles: [1] });
  return done();
}
