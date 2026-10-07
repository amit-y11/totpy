// Parse and build otpauth:// URIs (Key Uri Format).

import { isValidBase32, normalizeBase32 } from './base32.ts';
import { parseMigrationUri } from './migration.ts';
import { isAlgorithm } from './totp.ts';
import type { EntryFields } from './types.ts';

export const DIGIT_OPTIONS = [6, 7, 8];

export function validateEntryFields({ secret, algorithm, digits, period }: EntryFields): void {
  if (!isValidBase32(secret)) throw new Error('Secret key must be a valid base32 string');
  if (!isAlgorithm(algorithm)) throw new Error(`Unsupported algorithm: ${algorithm}`);
  if (!DIGIT_OPTIONS.includes(digits)) throw new Error('Digits must be 6, 7 or 8');
  if (!Number.isInteger(period) || period < 1 || period > 300) {
    throw new Error('Period must be between 1 and 300 seconds');
  }
}

export function parseOtpauthUri(input: string): EntryFields {
  const raw = input.trim();
  if (raw.startsWith('otpauth-migration:')) {
    throw new Error('This is a Google Authenticator export. Import it as a list instead.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid otpauth:// link');
  }
  if (url.protocol !== 'otpauth:') throw new Error('Not a valid otpauth:// link');
  if (url.host.toLowerCase() !== 'totp') {
    throw new Error('Only time-based (TOTP) codes are supported');
  }

  // Split on the first literal colon before decoding, so an encoded colon
  // (%3A) inside the issuer or account stays part of that name.
  const rawLabel = url.pathname.replace(/^\//, '');
  const sep = rawLabel.indexOf(':');
  const labelIssuer = sep >= 0 ? decodeURIComponent(rawLabel.slice(0, sep)) : '';
  const account = decodeURIComponent(sep >= 0 ? rawLabel.slice(sep + 1) : rawLabel);
  const params = url.searchParams;

  const algorithm = (params.get('algorithm') || 'SHA1').toUpperCase();
  if (!isAlgorithm(algorithm)) throw new Error(`Unsupported algorithm: ${algorithm}`);
  const entry: EntryFields = {
    issuer: (params.get('issuer') || labelIssuer).trim(),
    account: account.trim(),
    secret: normalizeBase32(params.get('secret') || ''),
    algorithm,
    digits: Number.parseInt(params.get('digits') || '6', 10),
    period: Number.parseInt(params.get('period') || '30', 10),
  };
  validateEntryFields(entry);
  return entry;
}

export interface ParsedLinks {
  entries: EntryFields[];
  skipped: number;
  errors: string[];
}

/**
 * Parses text holding otpauth:// links and/or Google Authenticator export
 * links (otpauth-migration://), one per line.
 */
export function parseAccountLinks(text: string): ParsedLinks {
  const result: ParsedLinks = { entries: [], skipped: 0, errors: [] };
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  lines.forEach((line, i) => {
    try {
      if (line.startsWith('otpauth-migration:')) {
        const { entries, skipped } = parseMigrationUri(line);
        result.entries.push(...entries);
        result.skipped += skipped;
      } else {
        result.entries.push(parseOtpauthUri(line));
      }
    } catch (err) {
      const message = (err as Error).message;
      result.errors.push(lines.length > 1 ? `Line ${i + 1}: ${message}` : message);
    }
  });
  return result;
}

export function buildOtpauthUri(entry: EntryFields): string {
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(entry.account)}`
    : encodeURIComponent(entry.account);
  const params = new URLSearchParams({ secret: entry.secret });
  if (entry.issuer) params.set('issuer', entry.issuer);
  params.set('algorithm', entry.algorithm);
  params.set('digits', String(entry.digits));
  params.set('period', String(entry.period));
  return `otpauth://totp/${label}?${params}`;
}
