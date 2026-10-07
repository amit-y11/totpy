import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Decode, base32Encode, isValidBase32 } from '../src/lib/base32.ts';
import { hotp, secondsRemaining, totp } from '../src/lib/totp.ts';

const ascii = (s: string) => base32Encode(new TextEncoder().encode(s));

test('base32 round-trips and tolerates spaces, lowercase and padding', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(ascii('foobar'), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('mzxw 6ytb oi======'), new TextEncoder().encode('foobar'));
  assert.ok(isValidBase32('JBSW Y3DP'));
  assert.ok(!isValidBase32('JBSW1'));
  assert.throws(() => base32Decode('ABC!'));
});

test('HOTP matches RFC 4226 appendix D', async () => {
  const secret = ascii('12345678901234567890');
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  for (const [counter, code] of expected.entries()) {
    assert.equal(await hotp(secret, counter), code);
  }
});

test('TOTP matches RFC 6238 appendix B', async () => {
  const secrets = {
    SHA1: ascii('12345678901234567890'),
    SHA256: ascii('12345678901234567890123456789012'),
    SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const vectors: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [time, sha1, sha256, sha512] of vectors) {
    const now = time * 1000;
    assert.equal(await totp({ secret: secrets.SHA1, digits: 8 }, now), sha1);
    assert.equal(
      await totp({ secret: secrets.SHA256, algorithm: 'SHA256', digits: 8 }, now),
      sha256,
    );
    assert.equal(
      await totp({ secret: secrets.SHA512, algorithm: 'SHA512', digits: 8 }, now),
      sha512,
    );
  }
});

test('6-digit codes and countdown', async () => {
  assert.equal(await totp({ secret: ascii('12345678901234567890') }, 59_000), '287082');
  assert.equal(secondsRemaining(30, 59_000), 1);
  assert.equal(secondsRemaining(30, 60_000), 30);
});
