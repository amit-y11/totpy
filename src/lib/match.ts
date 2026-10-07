// Suggests accounts for the site the user is on, by comparing the page's
// hostname with each account's issuer.

import type { Entry } from './types.ts';

// Hostname labels that say nothing about which service it is.
const GENERIC_LABELS = new Set([
  'www',
  'app',
  'apps',
  'login',
  'signin',
  'auth',
  'account',
  'accounts',
  'id',
  'sso',
  'secure',
  'my',
  'portal',
  'console',
  'dashboard',
  'admin',
  'web',
  'm',
  'mobile',
]);
// Common second-level labels in country domains (example.co.uk).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or']);

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export function siteLabels(url: string): string[] {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (!hostname || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return [];
  const labels = hostname.split('.');
  labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1)!)) labels.pop();
  return labels.map(normalize).filter((l) => l.length >= 2 && !GENERIC_LABELS.has(l));
}

function score(issuer: string, labels: string[]): number {
  const name = normalize(issuer);
  if (name.length < 2) return 0;
  let best = 0;
  labels.forEach((label, i) => {
    // Labels closer to the registrable domain count more (github in gist.github.com).
    const weight = 1 + i / labels.length;
    if (name === label) best = Math.max(best, 3 * weight);
    else if (label.length >= 3 && name.startsWith(label)) best = Math.max(best, 2 * weight);
    else if (name.length >= 3 && label.startsWith(name)) best = Math.max(best, 1.5 * weight);
  });
  return best;
}

/** Returns the entries that match `url`, best first. */
export function matchEntries<T extends Pick<Entry, 'issuer'>>(entries: T[], url: string): T[] {
  const labels = siteLabels(url);
  if (!labels.length) return [];
  return entries
    .map((entry) => ({ entry, score: score(entry.issuer, labels) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.entry);
}

export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
