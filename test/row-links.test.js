import { expect, test } from 'bun:test';
import { dashboardPage } from '../src/ui.js';

// Pull the dashboard's client script out of the page and run rows() against it.
function client() {
  const html = dashboardPage('alice', 'flisk.sh');
  const js = html.split('<script>').pop().split('</script>')[0];
  const fns = js.slice(js.indexOf('function esc'), js.indexOf('function keyOf'));
  const fmt = 'function fmt(n){return String(n)}';
  const make = new Function('SITE', `${fmt}${fns};return {rows}`);
  return make('flisk.sh');
}

test('dashboard script parses', () => {
  const html = dashboardPage('alice', 'flisk.sh');
  const js = html.split('<script>').pop().split('</script>')[0];
  expect(() => new Function(js)).not.toThrow();
});

test('top pages rows get an icon that opens the page on the site', () => {
  const out = client().rows([{ k: '/p/abc', v: 2 }], 'pages');
  expect(out).toContain('href="https://flisk.sh/p/abc"');
  expect(out).toContain('target="_blank"');
  expect(out).toContain('rel="noopener noreferrer"');
});

test('link click rows open the clicked url; plain names get no icon', () => {
  const r = client().rows;
  expect(r([{ k: 'https://github.com/flisk-sh', v: 3 }], 'links')).toContain('href="https://github.com/flisk-sh"');
  expect(r([{ k: 'github.com/x', v: 3 }], 'sources')).toContain('href="https://github.com/x"');
  expect(r([{ k: 'Direct', v: 3 }], 'channels')).not.toContain('class="ol"');
  expect(r([{ k: 'GitHub', v: 3 }], 'sources')).not.toContain('class="ol"');
});

test('a hostile path cannot break out of the href', () => {
  const out = client().rows([{ k: '/"><script>x</script>', v: 1 }], 'pages');
  expect(out).not.toContain('<script>');
});
