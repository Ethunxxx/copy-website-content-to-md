'use strict';

/**
 * DOM-level tests for content/extractor.js, run under jsdom.
 *
 * The extractor is a browser script (not a module): it reads the globals
 * `TurndownService` and `globalThis.__WCM_CLEANUP__`, uses DOM APIs, and exposes
 * `globalThis.__WCM_EXTRACT__`. We reproduce that environment here by loading the
 * vendored Turndown + the extractor into this context and swapping in a fresh
 * jsdom document per test.
 *
 * NOTE: jsdom is not Chrome — selectors like `:has()`, computed styles, and
 * layout differ. These tests cover extraction wiring/logic, not pixel-faithful
 * rendering. The real browser path still needs the manual smoke test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// Pure cleanup module also assigns globalThis.__WCM_CLEANUP__ (needed by extractor).
require('../lib/markdown-cleanup.js');

// Give Turndown a DOM to find at load time, then load the browser scripts so
// their top-level globals (TurndownService, __WCM_EXTRACT__) attach here.
applyDomGlobals(new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' }).window);
loadIntoGlobal('lib/turndown.js');
loadIntoGlobal('content/extractor.js');

function loadIntoGlobal(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInThisContext(code, { filename: rel });
}

function applyDomGlobals(window) {
  global.window = window;
  global.document = window.document;
  global.DOMParser = window.DOMParser;
  global.Node = window.Node;
}

function extract(html, { url = 'https://example.com/article', includeImages = false } = {}) {
  applyDomGlobals(new JSDOM(html, { url }).window);
  return globalThis.__WCM_EXTRACT__({ includeImages });
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${bodyHtml}</body></html>`;
}

const LONG_TEXT =
  'This is a sufficiently long article paragraph that comfortably exceeds the ' +
  'one hundred character minimum required for the extractor to treat it as the ' +
  'main content of the page.';

test('extracts an article with title and metadata header', () => {
  const result = extract(page('My Article', `<article><h2>Heading</h2><p>${LONG_TEXT}</p></article>`));

  assert.equal(result.success, true);
  assert.equal(result.title, 'My Article');
  assert.match(result.markdown, /^# My Article/);
  assert.match(result.markdown, /\*\*Source:\*\* https:\/\/example\.com\/article/);
  assert.match(result.markdown, /\*\*Site:\*\* example\.com/);
  assert.ok(result.markdown.includes('sufficiently long article'));
});

test('excludes images by default and includes them when requested', () => {
  const html = page('Pics', `<article><p>${LONG_TEXT}</p><img src="https://example.com/pic.png" alt="A picture"></article>`);

  const without = extract(html, { includeImages: false });
  assert.doesNotMatch(without.markdown, /!\[/);
  assert.doesNotMatch(without.html, /<img/i);

  const withImages = extract(html, { includeImages: true });
  assert.match(withImages.markdown, /!\[A picture\]\(https:\/\/example\.com\/pic\.png\)/);
});

test('strips script/style/noscript from the HTML export', () => {
  const html = page('Scripts', `<article><script>alert(1)</script><style>.a{}</style><p>${LONG_TEXT}</p></article>`);
  const result = extract(html);

  assert.doesNotMatch(result.html, /<script/i);
  assert.doesNotMatch(result.html, /<style/i);
  assert.ok(result.markdown.includes('sufficiently long article'));
});

test('removes structural chrome (nav/footer) from the output', () => {
  const html = page('Nav', `<article><nav>NAVLINKS</nav><p>${LONG_TEXT}</p><footer>FOOTERJUNK</footer></article>`);
  const result = extract(html);

  assert.doesNotMatch(result.markdown, /NAVLINKS/);
  assert.doesNotMatch(result.markdown, /FOOTERJUNK/);
});

test('does NOT split run-together text on a generic site', () => {
  const html = page('Generic', `<article><p>${LONG_TEXT} I really like Node.Js a lot.</p></article>`);
  const result = extract(html, { url: 'https://example.com/article' });

  assert.match(result.markdown, /Node\.Js/);
});

test('applies run-together fixes on a Substack page', () => {
  const html = page('Substack', `<article><p>${LONG_TEXT} End of one.Start of two.</p></article>`);
  const result = extract(html, { url: 'https://blog.substack.com/p/post' });

  assert.match(result.markdown, /End of one\.\s*\n\nStart of two/);
});

test('cleans the LinkedIn page title via the site handler', () => {
  const html = page('(4) Jane Doe | LinkedIn', `<main><h2>About</h2><p>${LONG_TEXT}</p></main>`);
  const result = extract(html, { url: 'https://www.linkedin.com/in/janedoe/' });

  assert.equal(result.title, 'Jane Doe');
  assert.match(result.markdown, /^# Jane Doe/);
});

test('returns a failure object instead of throwing on bad input', () => {
  // The extractor reads window.location first; make that throw and confirm the
  // error is caught and reported rather than propagated.
  global.window = {
    get location() { throw new Error('boom'); }
  };

  const result = globalThis.__WCM_EXTRACT__({ includeImages: false });
  assert.equal(result.success, false);
  assert.equal(typeof result.error, 'string');
});
