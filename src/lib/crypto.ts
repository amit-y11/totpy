// Vault encryption.
//
// Each vault has a random 256-bit master secret. Data is encrypted with
// AES-256-GCM under a key derived from that secret (HKDF). The secret itself
// is stored twice, wrapped by keys derived (PBKDF2-SHA256) from:
//   - the master password, and
//   - the recovery code.
// Changing the password only re-wraps the secret, so every device keeps
// decrypting the same data. The wraps are authenticated with an HMAC keyed
// from the secret, so a tampered sync copy cannot swap in wraps that would
// lock the user out.
//
// The same envelope format is used for the local vault, every sync provider,
// automatic copies and exported backup files.

import { base32Encode, normalizeBase32 } from './base32.ts';
import type { Bytes, Envelope, KdfParams, VaultData, VaultKeys, Wrap } from './types.ts';

export const FORMAT = 'otp-vault';
export const FORMAT_VERSION = 2;
export const DEFAULT_ITERATIONS = 600_000;
// Refuse weaker parameters so a tampered remote file cannot downgrade the KDF.
export const MIN_ITERATIONS = 100_000;
// The recovery code has 160 bits of entropy, so fewer iterations are fine.
const RECOVERY_ITERATIONS = MIN_ITERATIONS;
const MAX_ITERATIONS = 10_000_000;
const HASHES = ['SHA-256', 'SHA-512'];

type Purpose = 'password' | 'recovery';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class DecryptError extends Error {
  constructor(message = 'Wrong password or corrupted data') {
    super(message);
    this.name = 'DecryptError';
  }
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(str: string): Bytes {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

const randomBytes = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

async function transform(bytes: Bytes, stream: GenericTransformStream): Promise<Bytes> {
  const body = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function newKdfParams(iterations = DEFAULT_ITERATIONS): KdfParams {
  return { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(randomBytes(16)) };
}

function validateKdf(kdf: KdfParams | undefined): void {
  if (
    !kdf ||
    kdf.name !== 'PBKDF2' ||
    !HASHES.includes(kdf.hash) ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < MIN_ITERATIONS ||
    kdf.iterations > MAX_ITERATIONS ||
    typeof kdf.salt !== 'string' ||
    fromBase64(kdf.salt).length < 16
  ) {
    throw new Error('Unsupported or unsafe key-derivation parameters');
  }
}

function validateWrap(wrap: Wrap | undefined): void {
  if (!wrap || typeof wrap.iv !== 'string' || typeof wrap.ct !== 'string') {
    throw new Error('Vault file is malformed');
  }
  validateKdf(wrap.kdf);
}

/** Checks the shape of untrusted input (sync copies, backup files). */
export function validateEnvelope(env: unknown): asserts env is Envelope {
  const e = env as Partial<Envelope> | null;
  if (!e || e.format !== FORMAT || e.version !== FORMAT_VERSION) {
    throw new Error('Not a Totpy vault file');
  }
  const { keys } = e;
  if (
    typeof e.keyId !== 'string' ||
    typeof e.iv !== 'string' ||
    typeof e.ct !== 'string' ||
    !keys ||
    typeof keys.mac !== 'string' ||
    !Number.isFinite(keys.updatedAt)
  ) {
    throw new Error('Vault file is malformed');
  }
  validateWrap(keys.password);
  if (keys.recovery != null) validateWrap(keys.recovery);
}

// ---- Master secret ----------------------------------------------------------

export function newVaultSecret(): { keyId: string; secret: Bytes } {
  return { keyId: toBase64(randomBytes(16)), secret: randomBytes(32) };
}

async function subkeys(secret: Bytes): Promise<{ data: CryptoKey; mac: CryptoKey }> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const params = (info: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(32),
    info: encoder.encode(info),
  });
  const [data, mac] = await Promise.all([
    crypto.subtle.deriveKey(
      params(`${FORMAT} data`),
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
    crypto.subtle.deriveKey(
      params(`${FORMAT} keys`),
      base,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    ),
  ]);
  return { data, mac };
}

// ---- Password and recovery-code wraps --------------------------------------

export function generateRecoveryCode(): string {
  return base32Encode(randomBytes(20)).match(/.{4}/g)!.join('-');
}

function credentialText(purpose: Purpose, value: string): string {
  return purpose === 'recovery' ? normalizeBase32(value) : value.normalize('NFKC');
}

async function wrappingKey(purpose: Purpose, value: string, kdf: KdfParams): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(credentialText(purpose, value)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: kdf.hash, salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function kdfLabel(kdf: KdfParams): string {
  return `${kdf.name}:${kdf.hash}:${kdf.iterations}:${kdf.salt}`;
}

function wrapAad(purpose: Purpose, keyId: string, kdf: KdfParams): Bytes {
  return encoder.encode(`${FORMAT}:wrap:${purpose}:${keyId}:${kdfLabel(kdf)}`);
}

export async function wrapSecret(
  secret: Bytes,
  keyId: string,
  purpose: Purpose,
  value: string,
): Promise<Wrap> {
  const kdf = newKdfParams(purpose === 'recovery' ? RECOVERY_ITERATIONS : DEFAULT_ITERATIONS);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: wrapAad(purpose, keyId, kdf) },
    await wrappingKey(purpose, value, kdf),
    secret,
  );
  return { kdf, iv: toBase64(iv), ct: toBase64(ct) };
}

export async function unwrapSecret(
  wrap: Wrap,
  keyId: string,
  purpose: Purpose,
  value: string,
): Promise<Bytes> {
  validateWrap(wrap);
  try {
    const secret = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(wrap.iv),
        additionalData: wrapAad(purpose, keyId, wrap.kdf),
      },
      await wrappingKey(purpose, value, wrap.kdf),
      fromBase64(wrap.ct),
    );
    return new Uint8Array(secret);
  } catch {
    throw new DecryptError(
      purpose === 'recovery' ? 'Incorrect recovery code' : 'Incorrect password',
    );
  }
}

type UnsealedKeys = Omit<VaultKeys, 'mac'>;

function keysPayload(keyId: string, { password, recovery, updatedAt }: UnsealedKeys): Bytes {
  const wrap = (w: Wrap | null) => (w ? [kdfLabel(w.kdf), w.iv, w.ct] : null);
  return encoder.encode(JSON.stringify([FORMAT, keyId, updatedAt, wrap(password), wrap(recovery)]));
}

/** Authenticates a set of wraps with the vault secret. */
export async function sealKeys(
  secret: Bytes,
  keyId: string,
  {
    password,
    recovery = null,
    updatedAt,
  }: Omit<UnsealedKeys, 'recovery'> & { recovery?: Wrap | null },
): Promise<VaultKeys> {
  const keys: UnsealedKeys = { password, recovery, updatedAt };
  const { mac } = await subkeys(secret);
  const sig = await crypto.subtle.sign('HMAC', mac, keysPayload(keyId, keys));
  return { ...keys, mac: toBase64(sig) };
}

// ---- Vault data -------------------------------------------------------------

function dataAad(keyId: string): Bytes {
  return encoder.encode(`${FORMAT}:${FORMAT_VERSION}:data:${keyId}`);
}

export async function encryptVault(
  secret: Bytes,
  keyId: string,
  keys: VaultKeys,
  data: VaultData,
): Promise<Envelope> {
  const { data: key } = await subkeys(secret);
  const iv = randomBytes(12);
  const plain = await transform(
    encoder.encode(JSON.stringify(data)),
    new CompressionStream('gzip'),
  );
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: dataAad(keyId) },
    key,
    plain,
  );
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    keyId,
    keys,
    iv: toBase64(iv),
    ct: toBase64(ct),
  };
}

export async function decryptVault(secret: Bytes, env: Envelope): Promise<VaultData> {
  validateEnvelope(env);
  const { data: key, mac } = await subkeys(secret);
  const keysValid = await crypto.subtle.verify(
    'HMAC',
    mac,
    fromBase64(env.keys.mac),
    keysPayload(env.keyId, env.keys),
  );
  if (!keysValid) throw new DecryptError('Vault data was tampered with or is corrupted');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.iv), additionalData: dataAad(env.keyId) },
      key,
      fromBase64(env.ct),
    );
  } catch {
    throw new DecryptError('Vault data was tampered with or is corrupted');
  }
  const json = await transform(new Uint8Array(plain), new DecompressionStream('gzip'));
  return JSON.parse(decoder.decode(json)) as VaultData;
}

export type Credential = { password: string } | { recoveryCode: string };

/** Opens an envelope with a password or recovery code. */
export async function openVault(
  env: Envelope,
  credential: Credential,
): Promise<{ secret: Bytes; data: VaultData }> {
  validateEnvelope(env);
  let secret: Bytes;
  if ('recoveryCode' in credential) {
    if (!env.keys.recovery) throw new Error('This vault has no recovery code');
    secret = await unwrapSecret(env.keys.recovery, env.keyId, 'recovery', credential.recoveryCode);
  } else {
    secret = await unwrapSecret(env.keys.password, env.keyId, 'password', credential.password);
  }
  return { secret, data: await decryptVault(secret, env) };
}

export async function sha256Hex(str: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
