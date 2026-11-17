// Suggested languages: which languages a site could add, judged by where its visitors come from
// and by country domains that show up in its pages (Citable puts the scanned domain in the path, like /salgoo.kr).
// English is the baseline and is never suggested. A language the site already serves under /ko/ is left out.

const LANG_BY_COUNTRY = {
  kr: 'ko', jp: 'ja', cn: 'zh', tw: 'zh', hk: 'zh', de: 'de', at: 'de', ch: 'de', fr: 'fr', be: 'fr', es: 'es', mx: 'es', ar: 'es', co: 'es', cl: 'es', pe: 'es',
  it: 'it', pt: 'pt', br: 'pt', nl: 'nl', pl: 'pl', tr: 'tr', ru: 'ru', ua: 'uk', se: 'sv', no: 'no', dk: 'da', fi: 'fi', cz: 'cs', sk: 'sk', gr: 'el', hu: 'hu',
  ro: 'ro', bg: 'bg', hr: 'hr', rs: 'sr', lt: 'lt', lv: 'lv', ee: 'et', il: 'he', sa: 'ar', ae: 'ar', eg: 'ar', ir: 'fa', th: 'th', vn: 'vi', id: 'id', my: 'ms', ph: 'fil', in: 'hi',
};

const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const langNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
export const nameOf = (code) => { try { return langNames?.of(code) || code; } catch { return code; } };

const LANG_BY_COUNTRY_NAME = new Map();
for (const [cc, lang] of Object.entries(LANG_BY_COUNTRY)) {
  try { const n = regionNames?.of(cc.toUpperCase()); if (n) LANG_BY_COUNTRY_NAME.set(n, lang); } catch { /* skip */ }
}
const SERVED_RE = /^\/([a-z]{2,3})(?:[-_][a-z]{2,4})?(?:\/|$)/i;
const DOMAIN_PATH_RE = /^\/(?:[a-z0-9-]+\.)+([a-z]{2})(?:\/|$)/i;

// countries and pages are [{k, v}] rows. Returns [{k: 'Korean', v: visitors, n: 'why'}] sorted by visitors.
export function suggestLanguages(countries, pages) {
  const served = new Set();
  const found = new Map();
  const add = (lang, signal, v, label) => {
    const e = found.get(lang) || { country: 0, domain: 0, notes: [] };
    e[signal] = Math.max(e[signal], v);
    e.notes.push(label);
    found.set(lang, e);
  };
  for (const { k, v } of pages) {
    const s = SERVED_RE.exec(k);
    if (s && Object.values(LANG_BY_COUNTRY).includes(s[1].toLowerCase())) served.add(s[1].toLowerCase());
    const d = DOMAIN_PATH_RE.exec(k);
    const lang = d && LANG_BY_COUNTRY[d[1].toLowerCase()];
    if (lang) add(lang, 'domain', v, `.${d[1].toLowerCase()} domain scanned`);
  }
  for (const { k, v } of countries) {
    const lang = LANG_BY_COUNTRY_NAME.get(k);
    if (lang) add(lang, 'country', v, `visitors from ${k}`);
  }
  return [...found].filter(([lang]) => !served.has(lang))
    .map(([lang, e]) => ({ k: nameOf(lang), v: Math.max(e.country, e.domain), n: [...new Set(e.notes)].slice(0, 2).join(', ') }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k)).slice(0, 10);
}
