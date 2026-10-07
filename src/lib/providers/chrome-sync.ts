// Sync provider backed by chrome.storage.sync (the user's signed-in browser
// profile). Items are capped at 8 KB, so the envelope is split into chunks
// and verified with a checksum, since chunks may arrive on other devices
// at different times.

import { sha256Hex } from '../crypto.ts';
import type { Envelope, SyncProvider } from '../types.ts';

const PREFIX = 'otpVault.';
export const META_KEY = `${PREFIX}meta`;
const CHUNK_PREFIX = `${PREFIX}chunk.`;
const CHUNK_SIZE = 7000;

interface Meta {
  count: number;
  sha256: string;
  updatedAt: number;
}

async function ownKeys(): Promise<string[]> {
  const all = await chrome.storage.sync.get(null);
  return Object.keys(all).filter((k) => k.startsWith(PREFIX));
}

const chromeSync: SyncProvider = {
  id: 'chrome-sync',
  name: 'Chrome sync',
  description:
    'Syncs through your signed-in Chrome profile. No setup needed. Fits several hundred accounts.',

  availability() {
    return chrome.storage?.sync
      ? { ok: true }
      : { ok: false, reason: 'chrome.storage.sync is not available in this browser.' };
  },

  async connect() {},

  async disconnect() {},

  async read() {
    const all = await chrome.storage.sync.get(null);
    const meta = all[META_KEY] as Meta | undefined;
    if (!meta) return null;
    let json = '';
    for (let i = 0; i < meta.count; i++) {
      const chunk = all[`${CHUNK_PREFIX}${i}`];
      if (typeof chunk !== 'string') throw new Error('Sync data is still arriving. Will retry.');
      json += chunk;
    }
    if ((await sha256Hex(json)) !== meta.sha256) {
      throw new Error('Sync data is still arriving. Will retry.');
    }
    return JSON.parse(json) as Envelope;
  },

  async write(env) {
    const json = JSON.stringify(env);
    if (json.length > chrome.storage.sync.QUOTA_BYTES * 0.9) {
      throw new Error(
        'Vault is too large for Chrome sync (about 100 KB). Use Google Drive instead.',
      );
    }
    const items: Record<string, unknown> = {};
    let count = 0;
    for (let i = 0; i < json.length; i += CHUNK_SIZE) {
      items[`${CHUNK_PREFIX}${count++}`] = json.slice(i, i + CHUNK_SIZE);
    }
    const meta: Meta = { count, sha256: await sha256Hex(json), updatedAt: Date.now() };
    items[META_KEY] = meta;

    const stale = (await ownKeys()).filter(
      (k) => k.startsWith(CHUNK_PREFIX) && Number(k.slice(CHUNK_PREFIX.length)) >= count,
    );
    await chrome.storage.sync.set(items);
    if (stale.length) await chrome.storage.sync.remove(stale);
  },

  async remove() {
    const keys = await ownKeys();
    if (keys.length) await chrome.storage.sync.remove(keys);
  },
};

export default chromeSync;
