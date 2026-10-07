import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Decode } from '../src/lib/base32.ts';
import { parseMigrationUri } from '../src/lib/migration.ts';
import { parseAccountLinks } from '../src/lib/otpauth.ts';

// Tiny protobuf encoder for building Google Authenticator export payloads.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const bytesField = (field: number, bytes: number[]): number[] => [
  ...varint(field * 8 + 2),
  ...varint(bytes.length),
  ...bytes,
];
const intField = (field: number, value: number): number[] => [
  ...varint(field * 8),
  ...varint(value),
];
const text = (s: string): number[] => [...new TextEncoder().encode(s)];

interface OtpParams {
  secret: string;
  name: string;
  issuer?: string;
  algorithm?: number;
  digits?: number;
  type?: number;
}

function otp({
  secret,
  name,
  issuer = '',
  algorithm = 1,
  digits = 1,
  type = 2,
}: OtpParams): number[] {
  return [
    ...bytesField(1, [...base32Decode(secret)]),
    ...bytesField(2, text(name)),
    ...(issuer ? bytesField(3, text(issuer)) : []),
    ...intField(4, algorithm),
    ...intField(5, digits),
    ...intField(6, type),
  ];
}

function exportUri(params: OtpParams[]): string {
  const payload = [
    ...params.flatMap((p) => bytesField(1, otp(p))),
    ...intField(2, 1),
    ...intField(3, 1),
    ...intField(4, 0),
  ];
  const data = btoa(String.fromCharCode(...payload));
  return `otpauth-migration://offline?data=${encodeURIComponent(data)}`;
}

test('parses a Google Authenticator export', () => {
  const uri = exportUri([
    { secret: 'JBSWY3DPEHPK3PXP', name: 'GitHub:octocat', issuer: 'GitHub' },
    {
      secret: 'GEZDGNBVGY3TQOJQ',
      name: 'me@example.com',
      issuer: 'Google',
      algorithm: 2,
      digits: 2,
    },
    { secret: 'MZXW6YTBOI', name: 'Legacy:me' },
  ]);
  const { entries, skipped } = parseMigrationUri(uri);
  assert.equal(skipped, 0);
  assert.deepEqual(entries, [
    {
      issuer: 'GitHub',
      account: 'octocat',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    },
    {
      issuer: 'Google',
      account: 'me@example.com',
      secret: 'GEZDGNBVGY3TQOJQ',
      algorithm: 'SHA256',
      digits: 8,
      period: 30,
    },
    {
      issuer: 'Legacy',
      account: 'me',
      secret: 'MZXW6YTBOI',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    },
  ]);
});

test('skips counter-based (HOTP) and MD5 accounts', () => {
  const uri = exportUri([
    { secret: 'JBSWY3DPEHPK3PXP', name: 'a', type: 1 },
    { secret: 'JBSWY3DPEHPK3PXP', name: 'b', algorithm: 4 },
    { secret: 'JBSWY3DPEHPK3PXP', name: 'c' },
  ]);
  const { entries, skipped } = parseMigrationUri(uri);
  assert.equal(skipped, 2);
  assert.equal(entries.length, 1);
});

test('accepts base64 that lost its + signs to URL decoding', () => {
  const uri = exportUri([{ secret: '7777777777777777', name: 'x' }]);
  const spaced = decodeURIComponent(uri).replaceAll('+', ' ');
  assert.equal(parseMigrationUri(spaced).entries.length, 1);
});

test('rejects garbage', () => {
  assert.throws(() => parseMigrationUri('otpauth-migration://offline'), /Google Authenticator/);
  assert.throws(() => parseMigrationUri('otpauth-migration://offline?data=%2F%2F%2F%2F'));
});

test('parseAccountLinks mixes otpauth and migration links', () => {
  const text = [
    'otpauth://totp/A:a?secret=JBSWY3DPEHPK3PXP',
    exportUri([{ secret: 'GEZDGNBVGY3TQOJQ', name: 'B:b' }]),
    'not a link',
  ].join('\n');
  const result = parseAccountLinks(text);
  assert.equal(result.entries.length, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? '', /^Line 3/);
});
