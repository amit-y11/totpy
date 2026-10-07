// Sync engine: pull every enabled provider, merge, write back what changed.

import { decryptVault, encryptVault, openVault, validateEnvelope } from './crypto.ts';
import { getProvider, providers } from './providers/index.ts';
import {
  getEnvelope,
  getSession,
  getSettings,
  recoverVault,
  setEnvelope,
  setSession,
  setSyncStatus,
  updateSettings,
  withLock,
} from './store.ts';
import type {
  Bytes,
  Envelope,
  ProviderId,
  SyncProvider,
  SyncStatus,
  VaultData,
  VaultKeys,
} from './types.ts';
import { canonicalize, mergeData, pruneTombstones } from './vault.ts';

export interface JoinTarget {
  keyId: string;
  secret: Bytes;
  keys: VaultKeys;
}

export interface SyncOptions {
  /** Join another vault: merge into it and use its secret and wraps from now on. */
  adopt?: JoinTarget | null;
  /** Restrict to these providers. */
  only?: ProviderId[] | null;
  /** Provider whose remote copy is replaced without reading it. */
  overwrite?: ProviderId | null;
}

export type SyncResult =
  { skipped: true } | { skipped?: false; changed: boolean; status: SyncStatus };

async function enabledProviders(): Promise<SyncProvider[]> {
  const settings = await getSettings();
  return providers.filter((p) => settings.providers[p.id] && p.availability().ok);
}

const errorStatus = (err: unknown) => ({
  state: 'error' as const,
  error: (err as Error).message,
  at: Date.now(),
});

/**
 * Copies are matched by `keyId`: copies of the same vault share one secret and
 * merge silently, picking up the newest password/recovery wraps. A copy of a
 * different vault reports `needs-password` until the user joins it (`adopt`).
 */
export function syncNow({
  adopt = null,
  only = null,
  overwrite = null,
}: SyncOptions = {}): Promise<SyncResult> {
  return withLock(async (): Promise<SyncResult> => {
    const session = await getSession();
    const localEnv = await getEnvelope();
    if (!session || !localEnv || localEnv.keyId !== session.keyId) return { skipped: true };

    const localData = await decryptVault(session.secret, localEnv);
    const keyring = new Map<string, Bytes>([[localEnv.keyId, session.secret]]);
    if (adopt) keyring.set(adopt.keyId, adopt.secret);
    const target = adopt ?? { keyId: localEnv.keyId, secret: session.secret };
    let keys = adopt ? adopt.keys : localEnv.keys;

    const active = (await enabledProviders()).filter((p) => !only || only.includes(p.id));
    const status: SyncStatus = {};
    const targets: { provider: SyncProvider; remote: Envelope | null; remoteData?: VaultData }[] =
      [];
    let merged = localData;

    for (const provider of active) {
      try {
        const remote = overwrite === provider.id ? null : await provider.read();
        if (!remote) {
          targets.push({ provider, remote: null });
          continue;
        }
        validateEnvelope(remote);
        const secret = keyring.get(remote.keyId);
        if (!secret) {
          status[provider.id] = { state: 'needs-password', at: Date.now() };
          continue;
        }
        // Also verifies the remote wraps, so adopting them below is safe.
        const remoteData = await decryptVault(secret, remote);
        merged = mergeData(merged, remoteData);
        if (remote.keyId === target.keyId && remote.keys.updatedAt > keys.updatedAt) {
          keys = remote.keys;
        }
        targets.push({ provider, remote, remoteData });
      } catch (err) {
        status[provider.id] = errorStatus(err);
      }
    }

    merged = pruneTombstones(merged);
    const mergedJson = canonicalize(merged);
    const changed = mergedJson !== canonicalize(localData);
    const sameKeys = (env: Envelope) => env.keyId === target.keyId && env.keys.mac === keys.mac;
    let out: Envelope | undefined;
    const envelope = async () =>
      (out ??= await encryptVault(target.secret, target.keyId, keys, merged));

    if (changed || !sameKeys(localEnv)) await setEnvelope(await envelope());
    if (adopt) await setSession({ keyId: adopt.keyId, secret: adopt.secret });

    for (const { provider, remote, remoteData } of targets) {
      try {
        const upToDate =
          remote && remoteData && sameKeys(remote) && canonicalize(remoteData) === mergedJson;
        if (!upToDate) await provider.write(await envelope());
        status[provider.id] = { state: 'ok', at: Date.now() };
      } catch (err) {
        status[provider.id] = errorStatus(err);
      }
    }

    await setSyncStatus(status);
    return { changed, status };
  });
}

async function readRemote(providerId: ProviderId): Promise<Envelope> {
  const remote = await getProvider(providerId).read();
  if (!remote) throw new Error('No synced vault found');
  validateEnvelope(remote);
  return remote;
}

/** Opens a synced copy of a different vault so this device can join it. */
export async function unlockRemote(providerId: ProviderId, password: string): Promise<JoinTarget> {
  const remote = await readRemote(providerId);
  const { secret } = await openVault(remote, { password });
  return { keyId: remote.keyId, secret, keys: remote.keys };
}

/** Sets up this device from an existing synced vault. */
export async function restoreFromProvider(
  providerId: ProviderId,
  password: string,
): Promise<SyncResult> {
  const remote = await readRemote(providerId);
  const { secret } = await openVault(remote, { password });
  await withLock(() => setEnvelope(remote));
  await setSession({ keyId: remote.keyId, secret });
  await updateSettings({ providers: { [providerId]: true } });
  return syncNow();
}

/** Sets up this device from a synced vault using its recovery code. */
export async function recoverFromProvider(
  providerId: ProviderId,
  recoveryCode: string,
  newPassword: string,
): Promise<SyncResult> {
  const remote = await readRemote(providerId);
  await recoverVault(remote, recoveryCode, newPassword);
  await updateSettings({ providers: { [providerId]: true } });
  return syncNow();
}

/** Asks the service worker to sync, so it finishes even if the popup closes. */
export function requestBackgroundSync(): Promise<SyncResult | null> {
  return chrome.runtime
    .sendMessage<{ type: 'sync' }, SyncResult>({ type: 'sync' })
    .catch(() => null);
}
