// Extension storage: encrypted vault in chrome.storage.local, the unlocked
// vault secret in chrome.storage.session (memory only, cleared when the
// browser exits).

import {
  decryptVault,
  encryptVault,
  fromBase64,
  generateRecoveryCode,
  newVaultSecret,
  openVault,
  sealKeys,
  toBase64,
  unwrapSecret,
  validateEnvelope,
  wrapSecret,
} from './crypto.ts';
import type {
  Bytes,
  Envelope,
  Session,
  Settings,
  SyncStatus,
  VaultData,
  VaultKeys,
} from './types.ts';
import { emptyData } from './vault.ts';

const VAULT_KEY = 'vault';
export const SESSION_KEY = 'vaultKey';
const SETTINGS_KEY = 'settings';
const STATUS_KEY = 'syncStatus';
export const AUTO_LOCK_ALARM = 'auto-lock';

const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  providers: { 'chrome-sync': false, 'google-drive': false },
};

export class LockedError extends Error {
  constructor() {
    super('Vault is locked');
    this.name = 'LockedError';
  }
}

/**
 * Serializes every read-modify-write of the vault across the popup, options
 * page and service worker (Web Locks are shared by same-origin contexts).
 */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks.request('otp-vault', fn);
}

export async function getEnvelope(): Promise<Envelope | null> {
  const { [VAULT_KEY]: env } = await chrome.storage.local.get(VAULT_KEY);
  return (env as Envelope | undefined) ?? null;
}

export function setEnvelope(env: Envelope): Promise<void> {
  return chrome.storage.local.set({ [VAULT_KEY]: env });
}

export async function isInitialized(): Promise<boolean> {
  return (await getEnvelope()) !== null;
}

export async function getSettings(): Promise<Settings> {
  const { [SETTINGS_KEY]: saved = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = saved as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    providers: { ...DEFAULT_SETTINGS.providers, ...settings.providers },
  };
}

export async function updateSettings(
  patch: Partial<Omit<Settings, 'providers'>> & { providers?: Partial<Settings['providers']> },
): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    providers: { ...current.providers, ...patch.providers },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const { [STATUS_KEY]: status = {} } = await chrome.storage.local.get(STATUS_KEY);
  return status as SyncStatus;
}

export async function setSyncStatus(patch: SyncStatus): Promise<SyncStatus> {
  const status = { ...(await getSyncStatus()), ...patch };
  await chrome.storage.local.set({ [STATUS_KEY]: status });
  return status;
}

// ---- Session ----------------------------------------------------------------

interface StoredSession {
  keyId: string;
  secret: string;
}

export async function getSession(): Promise<Session | null> {
  const { [SESSION_KEY]: raw } = await chrome.storage.session.get(SESSION_KEY);
  const stored = raw as StoredSession | undefined;
  return stored ? { keyId: stored.keyId, secret: fromBase64(stored.secret) } : null;
}

export async function setSession({ keyId, secret }: Session): Promise<void> {
  const stored: StoredSession = { keyId, secret: toBase64(secret) };
  await chrome.storage.session.set({ [SESSION_KEY]: stored });
  await scheduleAutoLock();
}

export async function scheduleAutoLock(): Promise<void> {
  const { autoLockMinutes } = await getSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: autoLockMinutes });
  }
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

// ---- Vault lifecycle --------------------------------------------------------

/** Creates a vault and returns its recovery code, which is shown once. */
export async function createVault(password: string, data = emptyData()): Promise<string> {
  const { keyId, secret } = newVaultSecret();
  const recoveryCode = generateRecoveryCode();
  const keys = await sealKeys(secret, keyId, {
    password: await wrapSecret(secret, keyId, 'password', password),
    recovery: await wrapSecret(secret, keyId, 'recovery', recoveryCode),
    updatedAt: Date.now(),
  });
  const env = await encryptVault(secret, keyId, keys, data);
  await withLock(() => setEnvelope(env));
  await setSession({ keyId, secret });
  return recoveryCode;
}

export async function unlock(password: string): Promise<void> {
  const env = await getEnvelope();
  if (!env) throw new Error('No vault on this device');
  const { secret } = await openVault(env, { password });
  await setSession({ keyId: env.keyId, secret });
}

export interface UnlockedVault {
  session: Session;
  env: Envelope;
  data: VaultData;
}

export async function readVault(): Promise<UnlockedVault> {
  const session = await getSession();
  if (!session) throw new LockedError();
  const env = await getEnvelope();
  if (!env || env.keyId !== session.keyId) {
    await lock();
    throw new LockedError();
  }
  return { session, env, data: await decryptVault(session.secret, env) };
}

/**
 * `mutator` receives the decrypted data and returns the new data, or null to
 * leave it unchanged.
 */
export function updateVault(
  mutator: (data: VaultData) => VaultData | null | Promise<VaultData | null>,
): Promise<VaultData> {
  return withLock(async () => {
    const { session, env, data } = await readVault();
    const next = await mutator(data);
    if (!next) return data;
    await setEnvelope(await encryptVault(session.secret, env.keyId, env.keys, next));
    return next;
  });
}

/**
 * Re-wraps the vault secret. The data and the secret stay the same, so other
 * devices keep decrypting it and simply pick up the newer wraps when syncing.
 */
async function replaceKeys(
  buildPatch: (secret: Bytes, keyId: string) => Promise<Partial<VaultKeys>>,
): Promise<void> {
  const { session, env, data } = await readVault();
  const keys = await sealKeys(session.secret, env.keyId, {
    ...env.keys,
    ...(await buildPatch(session.secret, env.keyId)),
    updatedAt: Date.now(),
  });
  await setEnvelope(await encryptVault(session.secret, env.keyId, keys, data));
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return withLock(async () => {
    const env = await getEnvelope();
    if (!env) throw new Error('No vault on this device');
    await unwrapSecret(env.keys.password, env.keyId, 'password', currentPassword);
    await replaceKeys(async (secret, keyId) => ({
      password: await wrapSecret(secret, keyId, 'password', newPassword),
    }));
  });
}

/** Replaces the recovery code; the previous one stops working. */
export function regenerateRecoveryCode(): Promise<string> {
  const recoveryCode = generateRecoveryCode();
  return withLock(async () => {
    await replaceKeys(async (secret, keyId) => ({
      recovery: await wrapSecret(secret, keyId, 'recovery', recoveryCode),
    }));
    return recoveryCode;
  });
}

/**
 * Opens `env` (the local vault or a synced copy) with the recovery code, sets
 * a new master password and makes it this device's vault.
 */
export async function recoverVault(
  env: Envelope | null,
  recoveryCode: string,
  newPassword: string,
): Promise<void> {
  validateEnvelope(env);
  const { secret, data } = await openVault(env, { recoveryCode });
  const keys = await sealKeys(secret, env.keyId, {
    ...env.keys,
    password: await wrapSecret(secret, env.keyId, 'password', newPassword),
    updatedAt: Date.now(),
  });
  const next = await encryptVault(secret, env.keyId, keys, data);
  await withLock(() => setEnvelope(next));
  await setSession({ keyId: env.keyId, secret });
}
