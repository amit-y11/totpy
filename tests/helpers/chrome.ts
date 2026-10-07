// Minimal in-memory chrome.* for unit tests. Each device has its own local
// and session storage; all devices share one chrome.storage.sync, like
// browsers signed in to the same Google account.

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type Listener = (changes: Changes, area: string) => void;

function storageArea(listeners: Listener[], name: string, quota: number) {
  const data = new Map<string, unknown>();
  const emit = (changes: Changes) => listeners.forEach((fn) => fn(changes, name));
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    QUOTA_BYTES: quota,
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      if (keys == null) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
      const list =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(
        list.filter((k) => data.has(k)).map((k) => [k, clone(data.get(k))]),
      );
    },
    async set(items: Record<string, unknown>) {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data.get(k), newValue: v };
        data.set(k, clone(v));
      }
      emit(changes);
    },
    async remove(keys: string | string[]) {
      const changes: Changes = {};
      for (const k of ([] as string[]).concat(keys)) {
        changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      emit(changes);
    },
  };
}

const sharedSync = storageArea([], 'sync', 102_400);

export function createDevice() {
  const listeners: Listener[] = [];
  return {
    storage: {
      local: storageArea(listeners, 'local', 10_485_760),
      session: storageArea(listeners, 'session', 10_485_760),
      sync: sharedSync,
      onChanged: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    alarms: { create: async () => {}, clear: async () => true, get: async () => null },
    runtime: {
      id: 'test',
      getManifest: () => ({ version: '0.0.0', oauth2: { client_id: 'YOUR_CLIENT_ID' } }),
      sendMessage: async () => null,
    },
  };
}

export type Device = ReturnType<typeof createDevice>;

/** Makes `device` the current globalThis.chrome. */
export function use(device: Device): void {
  globalThis.chrome = device as unknown as typeof chrome;
}

export async function clearSharedSync(): Promise<void> {
  await sharedSync.remove(Object.keys(await sharedSync.get(null)));
}

use(createDevice());
