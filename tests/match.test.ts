import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchEntries, siteLabels } from '../src/lib/match.ts';

const entries = [
  { id: '1', issuer: 'GitHub' },
  { id: '2', issuer: 'Google' },
  { id: '3', issuer: 'Amazon Web Services' },
  { id: '4', issuer: 'Cloudflare' },
  { id: '5', issuer: 'BBC' },
  { id: '6', issuer: '' },
];
const ids = (url: string) => matchEntries(entries, url).map((e) => e.id);

test('extracts meaningful hostname labels', () => {
  assert.deepEqual(siteLabels('https://accounts.google.com/signin'), ['google']);
  assert.deepEqual(siteLabels('https://www.bbc.co.uk/'), ['bbc']);
  assert.deepEqual(siteLabels('http://192.168.1.1/'), []);
  assert.deepEqual(siteLabels('chrome://extensions'), []);
});

test('matches the site to the right issuer', () => {
  assert.deepEqual(ids('https://github.com/login'), ['1']);
  assert.deepEqual(ids('https://gist.github.com/'), ['1']);
  assert.deepEqual(ids('https://accounts.google.com/'), ['2']);
  assert.deepEqual(ids('https://signin.aws.amazon.com/'), ['3']);
  assert.deepEqual(ids('https://dash.cloudflare.com/'), ['4']);
  assert.deepEqual(ids('https://www.bbc.co.uk/'), ['5']);
  assert.deepEqual(ids('https://example.com/'), []);
});
