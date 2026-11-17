/* Flisk Analytics: one pageview beacon, no cookies, no storage that identifies anyone.
   <script defer data-domain="example.com" src="https://flisk.sh/a.js"></script> */
(function () {
  var s = document.currentScript, d = s && s.getAttribute('data-domain');
  if (!d || navigator.webdriver || /Headless/i.test(navigator.userAgent)) return;
  var api = (s.getAttribute('data-api') || 'https://analytics.flisk.si') + '/e', last = '';
  function sid() {
    try { var k = '_fa', v = sessionStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 12); sessionStorage.setItem(k, v); } return v; } catch (e) { return ''; }
  }
  // The theme the visitor sees: data-flisk-theme, else data-theme (light and dark are not themes). Read at send time.
  function theme() {
    var h = document.documentElement, t = h.getAttribute('data-flisk-theme');
    if (!t) { t = h.getAttribute('data-theme') || ''; if (/^\s*(light|dark)\s*$/i.test(t)) t = ''; }
    return String(t || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  }
  function post(o) {
    o.d = d; o.s = sid(); o.t = theme();
    var body = JSON.stringify(o);
    if (navigator.sendBeacon) navigator.sendBeacon(api, body); else fetch(api, { method: 'POST', body: body, keepalive: true });
  }
  function send() {
    var p = location.pathname;
    if (p === last) return; // reloads and repeat route events count once
    last = p;
    post({ p: p, r: document.referrer, u: new URLSearchParams(location.search).get('utm_campaign') || '' });
  }
  // Link clicks: links that leave the site and file downloads. Host and path only, never the query.
  addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]'), u;
    if (!a) return;
    try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.host !== location.host || /\.(zip|pdf|dmg|exe|pkg|tgz|gz|csv|xlsx?|mp4)$/i.test(u.pathname)) post({ e: 'click', p: location.pathname, l: u.host + u.pathname });
  }, true);
  var ps = history.pushState; // single-page apps
  if (ps) history.pushState = function () { ps.apply(this, arguments); setTimeout(send, 0); };
  addEventListener('popstate', send);
  if (document.visibilityState === 'prerender') document.addEventListener('visibilitychange', send, { once: true }); else send();
})();
