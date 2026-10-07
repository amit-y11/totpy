// Automatic local copies: one encrypted snapshot per day, keeping the last 7,
// so a mistaken deletion or a bad sync can be undone without a backup file.
// Snapshots are the same encrypted envelopes as the vault; no key is needed
// to take one.

import { decryptVault } from './crypto.ts';
import { getEnvelope, readVault, updateVault } from './store.ts';
import type { Envelope } from './types.ts';
import { importEntries } from './vault.ts';

const STORAGE_KEY = 'autoBackups';
export const KEEP = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Backup {
  at: number;
  env: Envelope;
}

async function load(): Promise<Backup[]> {
  const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return list as Backup[];
}

/** Saves `env` (default: the current vault) if the newest copy is a day old. */
export async function maybeBackup(env: Envelope | null = null, now = Date.now()): Promise<boolean> {
  const snapshot = env ?? (await getEnvelope());
  if (!snapshot) return false;
  const list = await load();
  const [latest] = list;
  if (latest && (now - latest.at < DAY_MS || latest.env.ct === snapshot.ct)) return false;
  const next = [{ at: now, env: snapshot }, ...list].slice(0, KEEP);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return true;
}

/** Lists copies with their account count (requires the vault to be unlocked). */
export async function describeBackups(): Promise<{ at: number; count: number | null }[]> {
  const { session } = await readVault();
  const list = await load();
  return Promise.all(
    list.map(async ({ at, env }) => {
      if (env.keyId !== session.keyId) return { at, count: null };
      try {
        const data = await decryptVault(session.secret, env);
        return { at, count: data.entries.length };
      } catch {
        return { at, count: null };
      }
    }),
  );
}

/** Adds back accounts from a copy that are missing now; changes nothing else. */
export async function restoreBackup(at: number): Promise<number> {
  const backup = (await load()).find((b) => b.at === at);
  if (!backup) throw new Error('That copy no longer exists');
  let added = 0;
  await updateVault(async (current) => {
    const { session } = await readVault();
    if (backup.env.keyId !== session.keyId) {
      throw new Error('This copy belongs to a different vault');
    }
    const data = await decryptVault(session.secret, backup.env);
    const result = importEntries(current, data.entries);
    added = result.added;
    return added ? result.data : null;
  });
  return added;
}
