// Writes dist/_headers after the build: security headers for every page and
// long-lived caching for hashed assets. The Content-Security-Policy allows
// only this site's own scripts, plus the exact inline scripts found in the
// built HTML (by SHA-256 hash), so injected scripts are blocked.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

const hashes = new Set();
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(attrs) || !body.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`.trim(),
  // Inline style attributes drive the animations (CSS custom properties).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;

writeFileSync(join(DIST, '_headers'), headers);
console.log(`_headers written (${hashes.size} inline script hash${hashes.size === 1 ? '' : 'es'})`);
