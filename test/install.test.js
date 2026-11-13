import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'install-jekyll.sh');
const run = (cwd, ...args) => Bun.spawnSync(['sh', SCRIPT, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });

function site(layout = '<html>\n<head>\n  <title>x</title>\n</head>\n<body></body>\n</html>\n') {
  const d = mkdtempSync(join(tmpdir(), 'jekyll-'));
  writeFileSync(join(d, '_config.yml'), 'title: x\n');
  mkdirSync(join(d, '_layouts'));
  writeFileSync(join(d, '_layouts/default.html'), layout);
  return d;
}

test('writes the include and adds one line before </head>', () => {
  const d = site();
  expect(run(d, 'flisk.sh').exitCode).toBe(0);
  expect(readFileSync(join(d, '_includes/flisk-analytics.html'), 'utf8')).toContain('data-domain="flisk.sh" src="https://flisk.sh/a.js"');
  const layout = readFileSync(join(d, '_layouts/default.html'), 'utf8');
  expect(layout).toContain('  {% include flisk-analytics.html %}\n</head>');
  expect(layout.match(/flisk-analytics/g)).toHaveLength(1);
});

test('running it twice changes nothing the second time', () => {
  const d = site();
  run(d, 'flisk.sh');
  const once = readFileSync(join(d, '_layouts/default.html'), 'utf8');
  const second = run(d, 'flisk.sh');
  expect(second.exitCode).toBe(0);
  expect(readFileSync(join(d, '_layouts/default.html'), 'utf8')).toBe(once);
  expect(second.stdout.toString()).toContain('already has it');
});

test('refuses outside a Jekyll site and refuses a bad domain', () => {
  const empty = mkdtempSync(join(tmpdir(), 'nojekyll-'));
  expect(run(empty, 'flisk.sh').exitCode).toBe(1);
  const d = site();
  expect(run(d, 'a b;rm -rf').exitCode).toBe(2);
  expect(run(d).exitCode).toBe(2);
});

test('a layout without </head> is left alone with instructions', () => {
  const d = site('<p>no head</p>\n');
  const r = run(d, 'flisk.sh');
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain('Add {% include flisk-analytics.html %}');
  expect(readFileSync(join(d, '_layouts/default.html'), 'utf8')).toBe('<p>no head</p>\n');
});
