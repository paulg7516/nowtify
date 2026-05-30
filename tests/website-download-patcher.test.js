const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Extract just the nowtifyParseRelease function from the inline <script>
// in docs/index.html and evaluate it in isolation. We deliberately ignore
// the rest of the script (nav scroll listener, IIFE patcher, footer-year
// setter) since they touch the DOM and would require browser globals.
function loadParser() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  const match = html.match(/function nowtifyParseRelease\s*\([\s\S]*?\n\s{2}\}/);
  if (!match) throw new Error('nowtifyParseRelease function not found in docs/index.html');
  const source = `${match[0]}\nmodule.exports = { nowtifyParseRelease };`;
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.module.exports.nowtifyParseRelease;
}

const parse = loadParser();

test('returns null when data is falsy', () => {
  assert.equal(parse(null), null);
  assert.equal(parse(undefined), null);
});

test('returns null when assets is missing or not an array', () => {
  assert.equal(parse({}), null);
  assert.equal(parse({ assets: 'nope' }), null);
});

test('returns null when no .dmg asset is present', () => {
  const data = { tag_name: 'v0.5.10', assets: [{ name: 'foo.zip', browser_download_url: 'x', size: 1 }] };
  assert.equal(parse(data), null);
});

test('extracts href, version, and rounded MB size from a real-shaped payload', () => {
  const data = {
    tag_name: 'v0.5.10',
    assets: [
      { name: 'latest-mac.yml', browser_download_url: 'https://x/yml', size: 521 },
      { name: 'Nowtify-0.5.10-universal.dmg', browser_download_url: 'https://x/dmg', size: 181273673 },
      { name: 'Nowtify-0.5.10-universal-mac.zip', browser_download_url: 'https://x/zip', size: 174859498 },
    ],
  };
  // Spread to flatten the prototype chain - the parser runs inside a vm
  // sandbox so its return value has a different Object.prototype than the
  // outer test context, which trips deepStrictEqual.
  assert.deepEqual({ ...parse(data) }, {
    href: 'https://x/dmg',
    version: 'v0.5.10',
    sizeMb: 173,
  });
});

test('falls back to data.name when tag_name is missing', () => {
  const data = {
    name: 'Release 0.6.0',
    assets: [{ name: 'Nowtify.dmg', browser_download_url: 'https://x/dmg', size: 1048576 }],
  };
  assert.equal(parse(data).version, 'Release 0.6.0');
});
