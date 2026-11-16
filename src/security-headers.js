// Baseline security headers for every response of the Worker. Headers a route already set are kept, never duplicated.
// Framing rules (X-Frame-Options, frame-ancestors) go on HTML pages only: the tracking script (/a.js) and the
// collect endpoint (/e) must stay embeddable and cross-origin, so they get no framing or CORS-affecting headers.
const BASELINE = {
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** Copy of `response` with the baseline headers added where missing. HTML also gets X-Frame-Options and frame-ancestors. */
export function withSecurityHeaders(response) {
  // A new Response, because the headers of some responses are immutable.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASELINE)) if (!out.headers.has(name)) out.headers.set(name, value);
  if (/^text\/html\b/i.test(out.headers.get('content-type') || '')) {
    if (!out.headers.has('x-frame-options')) out.headers.set('x-frame-options', 'SAMEORIGIN');
    const csp = out.headers.get('content-security-policy');
    if (!csp) out.headers.set('content-security-policy', "frame-ancestors 'self'");
    else if (!/(^|;)\s*frame-ancestors\b/i.test(csp)) out.headers.set('content-security-policy', `${csp}; frame-ancestors 'self'`);
  }
  return out;
}
