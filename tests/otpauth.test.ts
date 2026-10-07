import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOtpauthUri, parseOtpauthUri } from '../src/lib/otpauth.ts';
import type { EntryFields } from '../src/lib/types.ts';

test('parses a full otpauth URI', () => {
  const entry = parseOtpauthUri(
    'otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60',
  );
  assert.deepEqual(entry, {
    issuer: 'ACME Co',
    account: 'john.doe@email.com',
    secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
    algorithm: 'SHA256',
    digits: 8,
    period: 60,
  });
});

test('applies defaults and falls back to the label issuer', () => {
  const entry = parseOtpauthUri('otpauth://totp/GitHub:octocat?secret=jbswy3dpehpk3pxp');
  assert.equal(entry.issuer, 'GitHub');
  assert.equal(entry.account, 'octocat');
  assert.equal(entry.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(entry.algorithm, 'SHA1');
  assert.equal(entry.digits, 6);
  assert.equal(entry.period, 30);
});

test('rejects unsupported or invalid input', () => {
  assert.throws(() => parseOtpauthUri('https://example.com'), /otpauth/);
  assert.throws(() => parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DP&counter=1'), /TOTP/);
  assert.throws(() => parseOtpauthUri('otpauth://totp/x?secret=not*base32'), /base32/);
  assert.throws(() => parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&digits=5'), /Digits/);
  assert.throws(
    () => parseOtpauthUri('otpauth-migration://offline?data=abc'),
    /Google Authenticator/,
  );
});

test('build and parse round-trip', () => {
  const entry: EntryFields = {
    issuer: 'Example: Inc',
    account: 'me+2fa@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA512',
    digits: 7,
    period: 45,
  };
  const parsed = parseOtpauthUri(buildOtpauthUri(entry));
  assert.equal(parsed.account, entry.account);
  assert.equal(parsed.issuer, entry.issuer);
  assert.equal(parsed.secret, entry.secret);
  assert.equal(parsed.digits, 7);
});
