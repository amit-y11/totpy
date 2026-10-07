// RFC 4648 base32, as used by otpauth:// secrets.

import type { Bytes } from './types.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
}

export function isValidBase32(input: string): boolean {
  const s = normalizeBase32(input);
  return s.length > 0 && /^[A-Z2-7]+$/.test(s);
}

export function base32Decode(input: string): Bytes {
  const s = normalizeBase32(input);
  if (!/^[A-Z2-7]*$/.test(s)) {
    throw new Error('Secret key contains invalid characters');
  }
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of s) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
