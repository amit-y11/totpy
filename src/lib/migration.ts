// Google Authenticator "Transfer accounts" export:
//   otpauth-migration://offline?data=<base64 protobuf MigrationPayload>
//
// message MigrationPayload { repeated OtpParameters otp_parameters = 1; ... }
// message OtpParameters {
//   bytes secret = 1; string name = 2; string issuer = 3;
//   Algorithm algorithm = 4;  // 0 unspecified, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
//   DigitCount digits = 5;    // 0 unspecified, 1 six, 2 eight
//   OtpType type = 6;         // 0 unspecified, 1 HOTP, 2 TOTP
// }

import { base32Encode } from './base32.ts';
import type { Algorithm, EntryFields } from './types.ts';

const ALGORITHMS: Record<number, Algorithm> = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' };
const DIGITS: Record<number, number> = { 0: 6, 1: 6, 2: 8 };
const decoder = new TextDecoder();

type Field = { field: number; value: number | Uint8Array };

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (;;) {
    const byte = buf[pos++];
    if (byte === undefined) throw new Error('Truncated data');
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, pos];
    scale *= 128;
  }
}

function* readFields(buf: Uint8Array): Generator<Field> {
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      let value: number;
      [value, pos] = readVarint(buf, pos);
      yield { field, value };
    } else if (wire === 2) {
      let length: number;
      [length, pos] = readVarint(buf, pos);
      if (pos + length > buf.length) throw new Error('Truncated data');
      yield { field, value: buf.subarray(pos, pos + length) };
      pos += length;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new Error('Unsupported data');
    }
  }
}

function decodeBase64(text: string): Uint8Array {
  const normalized = text.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

interface OtpParameters {
  secret: Uint8Array | null;
  name: string;
  issuer: string;
  algorithm: number;
  digits: number;
  type: number;
}

function parseOtpParameters(buf: Uint8Array): OtpParameters {
  const p: OtpParameters = { secret: null, name: '', issuer: '', algorithm: 0, digits: 0, type: 0 };
  for (const { field, value } of readFields(buf)) {
    if (value instanceof Uint8Array) {
      if (field === 1) p.secret = value;
      else if (field === 2) p.name = decoder.decode(value);
      else if (field === 3) p.issuer = decoder.decode(value);
    } else if (field === 4) p.algorithm = value;
    else if (field === 5) p.digits = value;
    else if (field === 6) p.type = value;
  }
  return p;
}

export function parseMigrationUri(input: string): { entries: EntryFields[]; skipped: number } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Not a valid Google Authenticator export');
  }
  const data = url.searchParams.get('data');
  if (url.protocol !== 'otpauth-migration:' || !data) {
    throw new Error('Not a valid Google Authenticator export');
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(data);
  } catch {
    throw new Error('Not a valid Google Authenticator export');
  }

  const entries: EntryFields[] = [];
  let skipped = 0;
  for (const { field, value } of readFields(bytes)) {
    if (field !== 1 || !(value instanceof Uint8Array)) continue;
    const p = parseOtpParameters(value);
    const algorithm = ALGORITHMS[p.algorithm];
    const digits = DIGITS[p.digits];
    // Only time-based codes with supported parameters.
    if (!p.secret?.length || p.type === 1 || !algorithm || !digits) {
      skipped += 1;
      continue;
    }
    let issuer = p.issuer.trim();
    let account = p.name.trim();
    const sep = account.indexOf(':');
    if (sep >= 0 && (!issuer || account.slice(0, sep).trim() === issuer)) {
      issuer ||= account.slice(0, sep).trim();
      account = account.slice(sep + 1).trim();
    }
    entries.push({
      issuer,
      account,
      secret: base32Encode(p.secret),
      algorithm,
      digits,
      period: 30,
    });
  }
  return { entries, skipped };
}
