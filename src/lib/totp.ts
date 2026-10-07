// HOTP (RFC 4226) and TOTP (RFC 6238) using Web Crypto.

import { base32Decode } from './base32.ts';
import type { Algorithm, EntryFields } from './types.ts';

export const ALGORITHMS: Record<Algorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

export function isAlgorithm(value: string): value is Algorithm {
  return Object.hasOwn(ALGORITHMS, value);
}

export async function hotp(
  secret: string,
  counter: number,
  { algorithm = 'SHA1', digits = 6 }: { algorithm?: Algorithm; digits?: number } = {},
): Promise<string> {
  const hash = ALGORITHMS[algorithm];
  if (!hash) throw new Error(`Unsupported algorithm: ${algorithm}`);

  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const msg = new DataView(new ArrayBuffer(8));
  msg.setUint32(0, Math.floor(counter / 2 ** 32));
  msg.setUint32(4, counter >>> 0);

  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg.buffer));
  const offset = sig[sig.length - 1]! & 0x0f;
  const binary =
    ((sig[offset]! & 0x7f) << 24) |
    (sig[offset + 1]! << 16) |
    (sig[offset + 2]! << 8) |
    sig[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeCounter(period = 30, now = Date.now()): number {
  return Math.floor(now / 1000 / period);
}

export function secondsRemaining(period = 30, now = Date.now()): number {
  return period - ((now / 1000) % period);
}

export function totp(
  entry: Pick<EntryFields, 'secret'> & Partial<EntryFields>,
  now = Date.now(),
): Promise<string> {
  const { secret, algorithm = 'SHA1', digits = 6, period = 30 } = entry;
  return hotp(secret, timeCounter(period, now), { algorithm, digits });
}
