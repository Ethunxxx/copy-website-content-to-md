'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../lib/markdown-cleanup.js');

test('buildMetadataHeader includes required fields and omits empty optional ones', () => {
  const header = cleanup.buildMetadataHeader({
    url: 'https://example.com/post',
    dateStr: '2026-06-14 at 21:45',
    siteName: 'Example',
    authorName: null,
    section: null
  });

  assert.match(header, /\*\*Source:\*\* https:\/\/example\.com\/post/);
  assert.match(header, /\*\*Extracted:\*\* 2026-06-14 at 21:45/);
  assert.match(header, /\*\*Site:\*\* Example/);
  assert.doesNotMatch(header, /Author/);
  assert.doesNotMatch(header, /Section/);
});

test('buildMetadataHeader includes author and section when provided', () => {
  const header = cleanup.buildMetadataHeader({
    url: 'https://example.com',
    dateStr: 'x',
    siteName: 'Example',
    authorName: 'Jane Doe',
    section: 'Tech'
  });

  assert.match(header, /\*\*Author:\*\* Jane Doe/);
  assert.match(header, /\*\*Section:\*\* Tech/);
});

test('getSiteHandler resolves known hosts and returns null for others', () => {
  assert.equal(cleanup.getSiteHandler('www.linkedin.com').id, 'linkedin');
  assert.equal(cleanup.getSiteHandler('foo.substack.com').id, 'substack');
  assert.equal(cleanup.getSiteHandler('medium.com').id, 'medium');
  assert.equal(cleanup.getSiteHandler('example.com'), null);
  assert.equal(cleanup.getSiteHandler(''), null);
});

test('site handlers expose string selectors', () => {
  for (const handler of cleanup.SITE_HANDLERS) {
    assert.ok(Array.isArray(handler.contentSelectors));
    assert.ok(handler.contentSelectors.every((s) => typeof s === 'string'));
    assert.ok(Array.isArray(handler.removeSelectors));
    assert.ok(handler.removeSelectors.every((s) => typeof s === 'string'));
  }
});

test('postProcessMarkdown removes empty bold markers', () => {
  const out = cleanup.postProcessMarkdown('Hello ** ** world');
  assert.equal(out, 'Hello  world');
});

test('postProcessMarkdown does NOT split run-together text without a handler', () => {
  // Regression guard for the old global heuristic that mangled "Node.Js".
  const out = cleanup.postProcessMarkdown('I love Node.Js a lot.');
  assert.equal(out, 'I love Node.Js a lot.');
});

test('postProcessMarkdown splits run-together text when handler opts in', () => {
  const out = cleanup.postProcessMarkdown('End of one.Start of two', {
    handler: { fixRunTogether: true }
  });
  assert.match(out, /End of one\.\n\nStart of two/);
});

test('postProcessMarkdown collapses multi-line link text into one line', () => {
  const input = '[Click\n\n   here](https://example.com)';
  const out = cleanup.postProcessMarkdown(input);
  assert.equal(out, '[Click here](https://example.com)');
});

test('postProcessMarkdown removes empty links but keeps images', () => {
  assert.equal(cleanup.postProcessMarkdown('[](/path)'), '');
  const img = cleanup.postProcessMarkdown('![alt](https://example.com/a.png)');
  assert.equal(img, '![alt](https://example.com/a.png)');
});

test('postProcessMarkdown collapses consecutive duplicate links', () => {
  const dup = '[Apply](https://x.com)[Apply](https://x.com)';
  assert.equal(cleanup.postProcessMarkdown(dup), '[Apply](https://x.com)');
});

test('postProcessMarkdown collapses excessive blank lines', () => {
  assert.equal(cleanup.postProcessMarkdown('a\n\n\n\n\nb'), 'a\n\nb');
});

test('cleanLinkedInMarkdown removes Activity section and standalone action words', () => {
  const input = [
    '## About',
    'I build things.',
    '## Activity',
    'Liked a post',
    'Follow',
    '## Experience',
    'Engineer'
  ].join('\n');

  const out = cleanup.cleanLinkedInMarkdown(input);
  assert.match(out, /## About/);
  assert.match(out, /## Experience/);
  assert.doesNotMatch(out, /## Activity/);
  assert.doesNotMatch(out, /Liked a post/);
  assert.doesNotMatch(out, /^Follow$/m);
});

test('cleanLinkedInMarkdown deduplicates doubled section headers', () => {
  const out = cleanup.cleanLinkedInMarkdown('## AboutAbout');
  assert.match(out, /## About\b/);
  assert.doesNotMatch(out, /AboutAbout/);
});

test('cleanLinkedInTitle strips notification counts and suffix', () => {
  assert.equal(cleanup.cleanLinkedInTitle('(3) Jane Doe | LinkedIn'), 'Jane Doe');
});
