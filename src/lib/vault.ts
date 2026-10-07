// Pure vault data model and conflict-free merge.
//
// Every entry carries `updatedAt`; deletions leave a tombstone so they
// propagate between devices. Merging is commutative and idempotent, so any
// device can merge any copy in any order and converge on the same result.

import type { Entry, EntryFields, VaultData } from './types.ts';

export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function emptyData(): VaultData {
  return { version: 1, entries: [], tombstones: {} };
}

export function createEntry(fields: EntryFields, now = Date.now()): Entry {
  return {
    id: crypto.randomUUID(),
    issuer: fields.issuer,
    account: fields.account,
    secret: fields.secret,
    algorithm: fields.algorithm,
    digits: fields.digits,
    period: fields.period,
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertEntry(data: VaultData, entry: Entry, now = Date.now()): VaultData {
  const next = { ...entry, updatedAt: now };
  const tombstones = { ...data.tombstones };
  delete tombstones[entry.id];
  const entries = data.entries.filter((e) => e.id !== entry.id);
  entries.push(next);
  return { ...data, entries, tombstones };
}

export function deleteEntry(data: VaultData, id: string, now = Date.now()): VaultData {
  return {
    ...data,
    entries: data.entries.filter((e) => e.id !== id),
    tombstones: { ...data.tombstones, [id]: now },
  };
}

function newer(a: Entry, b: Entry): Entry {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Deterministic tie-break so every device picks the same winner.
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeData(a: VaultData, b: VaultData): VaultData {
  const tombstones = { ...a.tombstones };
  for (const [id, at] of Object.entries(b.tombstones ?? {})) {
    tombstones[id] = Math.max(tombstones[id] ?? 0, at);
  }
  const byId = new Map<string, Entry>();
  for (const entry of [...a.entries, ...b.entries]) {
    const current = byId.get(entry.id);
    byId.set(entry.id, current ? newer(current, entry) : entry);
  }
  const entries = [...byId.values()].filter((e) => !((tombstones[e.id] ?? -1) >= e.updatedAt));
  return { version: 1, entries, tombstones };
}

export function pruneTombstones(data: VaultData, now = Date.now()): VaultData {
  const tombstones = Object.fromEntries(
    Object.entries(data.tombstones).filter(([, at]) => now - at < TOMBSTONE_TTL_MS),
  );
  return { ...data, tombstones };
}

function sortKeys<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k as keyof T]]),
  ) as T;
}

/** Stable serialization used to decide whether two copies differ. */
export function canonicalize(data: VaultData): string {
  return JSON.stringify({
    version: data.version,
    entries: [...data.entries].sort((x, y) => (x.id < y.id ? -1 : 1)).map(sortKeys),
    tombstones: sortKeys(data.tombstones),
  });
}

export function sortForDisplay(entries: Entry[]): Entry[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return [...entries].sort(
    (x, y) =>
      collator.compare(x.issuer || x.account, y.issuer || y.account) ||
      collator.compare(x.account, y.account),
  );
}

export function isDuplicate(data: VaultData, fields: EntryFields): boolean {
  return data.entries.some((e) => e.secret === fields.secret && e.account === fields.account);
}

/**
 * Adds entries from another vault (backup file, otpauth list) as new
 * additions, so an older backup can bring back accounts deleted since.
 */
export function importEntries(
  data: VaultData,
  incoming: EntryFields[],
  now = Date.now(),
): { data: VaultData; added: number } {
  let next = data;
  let added = 0;
  for (const fields of incoming) {
    if (isDuplicate(next, fields)) continue;
    next = upsertEntry(next, createEntry(fields, now), now);
    added += 1;
  }
  return { data: next, added };
}
